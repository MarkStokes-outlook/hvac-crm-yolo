import { z } from 'zod';
import { q, insert, update, nextNumber, parseJson, getSetting, type Row } from '../db/index.ts';
import { audit, badRequest, notFound, type Actor } from '../lib/context.ts';
import { CATEGORY_SKILLS, DEFAULT_RATES, HOLD_REASONS, type Priority } from '../lib/domain.ts';
import { fgasStatus } from '../lib/compliance.ts';
import { nowIso, today } from '../lib/time.ts';
import { contractForSite, isOutOfHours, slaState, slaTargets, slaTerms } from './sla.ts';

export const JobInput = z.object({
  site_id: z.number().int(),
  customer_id: z.number().int().optional(),
  kind: z.enum(['reactive', 'ppm', 'remedial', 'quoted', 'installation', 'survey', 'warranty', 'recall']).default('reactive'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  reported_by: z.string().optional().nullable(),
  reported_contact_id: z.number().int().optional().nullable(),
  reported_via: z.enum(['phone', 'email', 'web', 'engineer', 'ppm_schedule', 'quote', 'internal']).default('phone'),
  customer_ref: z.string().optional().nullable(),
  nte_limit: z.number().optional().nullable(),
  charge_type: z.enum(['contract', 'chargeable', 'quoted', 'warranty', 'non_chargeable']).optional(),
  asset_ids: z.array(z.number().int()).default([]),
  required_skills: z.array(z.string()).optional(),
  est_hours: z.number().positive().optional(),
  target_start_on: z.string().optional().nullable(),
  due_on: z.string().optional().nullable(),
  parent_job_id: z.number().int().optional().nullable(),
  quote_id: z.number().int().optional().nullable(),
  ppm_plan_id: z.number().int().optional().nullable(),
  enquiry_id: z.number().int().optional().nullable(),
  override_on_stop: z.boolean().optional(),
});
export type JobInput = z.input<typeof JobInput>;

const OPEN_STATUSES = ['new', 'scheduled', 'in_progress', 'on_hold'];

export function inferSkills(assetIds: number[]): string[] {
  if (!assetIds.length) return [];
  const cats = q.all<{ category: string }>(`SELECT DISTINCT category FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`, ...assetIds);
  return [...new Set(cats.flatMap((c) => CATEGORY_SKILLS[c.category] ?? []))];
}

export function createJob(actor: Actor, raw: JobInput) {
  const input = JobInput.parse(raw);
  const site = q.get<Row>('SELECT * FROM sites WHERE id = ?', input.site_id);
  if (!site) throw notFound('Site');
  const customer = q.get<Row>('SELECT * FROM customers WHERE id = ?', site.customer_id)!;
  if (input.customer_id && input.customer_id !== customer.id) throw badRequest('Site does not belong to that customer');

  const contract = contractForSite(site.id);
  const coversReactive = contract && contract.level !== 'ppm_only';
  let chargeType = input.charge_type;
  if (!chargeType) {
    if (input.kind === 'ppm') chargeType = contract ? 'contract' : 'chargeable';
    else if (input.kind === 'warranty' || input.kind === 'recall') chargeType = input.kind === 'warranty' ? 'warranty' : 'non_chargeable';
    else if (input.kind === 'quoted' || input.kind === 'installation') chargeType = 'quoted';
    else chargeType = coversReactive && contract.labour_included ? 'contract' : 'chargeable';
  }

  if (customer.on_stop && chargeType === 'chargeable' && !input.override_on_stop) {
    throw badRequest(`${customer.name} is ON STOP (${customer.on_stop_reason ?? 'account hold'}). Chargeable work needs manager approval — set override_on_stop to proceed.`);
  }
  for (const aid of input.asset_ids) {
    const a = q.get<Row>('SELECT site_id FROM assets WHERE id = ?', aid);
    if (!a || a.site_id !== site.id) throw badRequest(`Asset ${aid} is not at ${site.name}`);
  }

  const now = new Date();
  const priority = input.priority as Priority;
  const targets = ['reactive', 'warranty', 'recall'].includes(input.kind) ? slaTargets(contract?.id, priority, now) : null;
  const ooh = input.kind === 'reactive' && priority === 'P1' && isOutOfHours(now) ? 1 : 0;
  const skills = input.required_skills?.length ? input.required_skills : inferSkills(input.asset_ids);
  const jobNo = nextNumber('job', 'J-', 5);

  const id = q.tx(() => {
    const jobId = insert('jobs', {
      job_no: jobNo,
      customer_id: customer.id,
      site_id: site.id,
      contract_id: contract?.id ?? null,
      kind: input.kind,
      priority,
      status: 'new',
      title: input.title,
      description: input.description ?? null,
      reported_by: input.reported_by ?? null,
      reported_contact_id: input.reported_contact_id ?? null,
      reported_via: input.reported_via,
      customer_ref: input.customer_ref ?? null,
      nte_limit: input.nte_limit ?? null,
      charge_type: chargeType,
      quote_id: input.quote_id ?? null,
      ppm_plan_id: input.ppm_plan_id ?? null,
      parent_job_id: input.parent_job_id ?? null,
      required_skills: JSON.stringify(skills),
      est_hours: input.est_hours ?? (input.kind === 'ppm' ? 3 : 2),
      ooh,
      target_start_on: input.target_start_on ?? null,
      due_on: input.due_on ?? null,
      respond_by: targets?.respond_by ?? null,
      fix_by: targets?.fix_by ?? null,
      invoice_status: chargeType === 'non_chargeable' || chargeType === 'warranty' ? 'not_chargeable' : 'not_ready',
      logged_by: actor.userId,
      owner_id: actor.role === 'coordinator' ? actor.userId : null,
    });
    for (const aid of input.asset_ids) insert('job_assets', { job_id: jobId, asset_id: aid });
    if (input.enquiry_id) {
      update('enquiries', input.enquiry_id, { status: 'actioned', job_id: jobId, customer_id: customer.id, site_id: site.id, handled_by: actor.userId, handled_at: nowIso() });
    }
    const slaText = targets ? ` — ${targets.terms.source === 'contract' ? 'contract' : 'standard'} SLA: attend by ${new Date(targets.respond_by).toLocaleString('en-GB')}` : '';
    addNote(actor, jobId, `Job logged (${input.kind}, ${priority}) via ${input.reported_via}${slaText}`, 'system');
    audit(actor, 'job', jobId, 'created', `${jobNo} ${input.title}`);
    return jobId;
  });

  const warnings: string[] = [];
  if (customer.po_required && !input.customer_ref && chargeType !== 'contract') warnings.push('Customer requires a PO / order number before chargeable work can be invoiced.');
  if (site.induction_required) warnings.push('Site requires induction before work starts.');
  if (site.dbs_required) warnings.push('Site requires DBS-checked engineers.');
  if (!contract && input.kind === 'reactive') warnings.push('No active contract — standard rates and response times apply.');
  if (contract?.level === 'ppm_only' && input.kind === 'reactive') warnings.push('Contract is PPM-only — reactive work is chargeable.');
  return { job: getJob(id), warnings };
}

export function getJob(id: number) {
  const job = q.get<Row>(
    `SELECT j.*, c.name AS customer_name, c.account_no, c.on_stop, c.po_required, s.name AS site_name, s.postcode AS site_postcode,
            s.address AS site_address, s.town AS site_town, s.lat, s.lng, s.access_notes, s.hazards, s.induction_required, s.dbs_required, s.parking_notes, s.opening_hours,
            ct.ref AS contract_ref, ct.name AS contract_name, ct.level AS contract_level,
            lu.name AS logged_by_name, ou.name AS owner_name, qt.quote_no, pj.job_no AS parent_job_no
     FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN sites s ON s.id = j.site_id
     LEFT JOIN contracts ct ON ct.id = j.contract_id LEFT JOIN users lu ON lu.id = j.logged_by LEFT JOIN users ou ON ou.id = j.owner_id
     LEFT JOIN quotes qt ON qt.id = j.quote_id LEFT JOIN jobs pj ON pj.id = j.parent_job_id
     WHERE j.id = ?`,
    id,
  );
  if (!job) throw notFound('Job');
  job.required_skills = parseJson(job.required_skills, []);
  job.sla = slaState(job as any);
  job.sla_terms = ['reactive', 'warranty', 'recall'].includes(job.kind) ? slaTerms(job.contract_id, job.priority) : null;
  job.assets = q.all(
    `SELECT a.* FROM assets a JOIN job_assets ja ON ja.asset_id = a.id WHERE ja.job_id = ? ORDER BY a.tag`,
    id,
  ).map((a) => ({ ...a, fgas: fgasStatus(a) }));
  job.visits = q.all(
    `SELECT v.*, e.name AS engineer_name, e.colour AS engineer_colour, e.phone AS engineer_phone FROM visits v JOIN engineers e ON e.id = v.engineer_id WHERE v.job_id = ? ORDER BY v.starts_at`,
    id,
  );
  job.notes = q.all(`SELECT n.*, u.name AS user_name FROM job_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.job_id = ? ORDER BY n.created_at DESC, n.id DESC`, id);
  job.parts = q.all(`SELECT jp.*, p.sku, sl.name AS location_name FROM job_parts jp LEFT JOIN parts p ON p.id = jp.part_id LEFT JOIN stock_locations sl ON sl.id = jp.location_id WHERE jp.job_id = ? ORDER BY jp.id`, id);
  job.attachments = q.all(`SELECT * FROM attachments WHERE entity_type = 'job' AND entity_id = ? ORDER BY created_at DESC`, id);
  job.defects = q.all(`SELECT d.*, a.tag AS asset_tag, qt.quote_no FROM defects d LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN quotes qt ON qt.id = d.quote_id WHERE d.job_id = ? ORDER BY d.id`, id);
  job.refrigerant_logs = q.all(`SELECT r.*, a.tag AS asset_tag, e.name AS engineer_name FROM refrigerant_logs r JOIN assets a ON a.id = r.asset_id LEFT JOIN engineers e ON e.id = r.engineer_id WHERE r.job_id = ? ORDER BY r.logged_on`, id);
  job.checklists = q.all(`SELECT vc.*, a.tag AS asset_tag, t.name AS template_name, t.items FROM visit_checklists vc JOIN visits v ON v.id = vc.visit_id LEFT JOIN assets a ON a.id = vc.asset_id LEFT JOIN checklist_templates t ON t.id = vc.template_id WHERE v.job_id = ?`, id).map((c) => ({
    ...c,
    items: parseJson(c.items, []),
    responses: parseJson(c.responses, {}),
  }));
  job.quotes = q.all(`SELECT id, quote_no, title, status FROM quotes WHERE source_job_id = ? OR id = ?`, id, job.quote_id ?? -1);
  job.purchase_orders = q.all(`SELECT po.id, po.po_no, po.status, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.job_id = ?`, id);
  job.follow_on_jobs = q.all(`SELECT id, job_no, title, status, kind FROM jobs WHERE parent_job_id = ?`, id);
  job.history = q.all(`SELECT al.*, u.name AS user_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id WHERE entity_type = 'job' AND entity_id = ? ORDER BY al.id DESC LIMIT 50`, id);
  job.valuation = valueJob(job);
  return job;
}

/** Rough commercial value of a job for invoicing hand-off (labour + callout + parts). */
export function valueJob(job: Row) {
  const rates = getSetting('rates', DEFAULT_RATES);
  let labourHours = 0;
  for (const v of job.visits ?? []) {
    if (v.arrived_at && v.departed_at) labourHours += (new Date(v.departed_at).getTime() - new Date(v.arrived_at).getTime()) / 3600_000;
  }
  labourHours = Math.round(labourHours * 4) / 4; // quarter-hour increments
  const partsCost = (job.parts ?? []).reduce((s: number, p: Row) => s + p.qty * p.unit_cost, 0);
  const partsSell = (job.parts ?? []).reduce((s: number, p: Row) => s + p.qty * p.unit_price, 0);
  const rate = job.ooh ? rates.labour_overtime : rates.labour_normal;
  const chargeable = job.charge_type === 'chargeable';
  const callout = chargeable && job.kind === 'reactive' ? (job.ooh ? rates.callout_ooh : rates.callout_normal) : 0;
  const labour = chargeable ? labourHours * rate : 0;
  return {
    labour_hours: labourHours,
    labour_rate: rate,
    labour_value: Math.round(labour * 100) / 100,
    callout_value: callout,
    parts_cost: Math.round(partsCost * 100) / 100,
    parts_value: Math.round(partsSell * 100) / 100,
    total_chargeable: chargeable ? Math.round((labour + callout + partsSell) * 100) / 100 : job.charge_type === 'contract' ? 0 : null,
    exceeds_nte: job.nte_limit ? labour + callout + partsSell > job.nte_limit : false,
  };
}

export const JobFilters = z.object({
  status: z.string().optional(), // comma list or 'open'
  kind: z.string().optional(),
  priority: z.string().optional(),
  customer_id: z.coerce.number().optional(),
  site_id: z.coerce.number().optional(),
  asset_id: z.coerce.number().optional(),
  engineer_id: z.coerce.number().optional(),
  contract_id: z.coerce.number().optional(),
  search: z.string().optional(),
  unscheduled: z.coerce.boolean().optional(),
  sla: z.enum(['at_risk', 'breached', 'at_risk_or_breached']).optional(),
  invoice_status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().max(500).default(200),
});

export function listJobs(raw: z.input<typeof JobFilters> = {}) {
  const f = JobFilters.parse(raw);
  const where: string[] = [];
  const params: unknown[] = [];
  const inList = (col: string, val: string) => {
    const vals = val.split(',').map((s) => s.trim()).filter(Boolean);
    where.push(`${col} IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  };
  if (f.status === 'open') where.push(`j.status IN ('new','scheduled','in_progress','on_hold')`);
  else if (f.status) inList('j.status', f.status);
  if (f.kind) inList('j.kind', f.kind);
  if (f.priority) inList('j.priority', f.priority);
  if (f.invoice_status) inList('j.invoice_status', f.invoice_status);
  if (f.customer_id) (where.push('j.customer_id = ?'), params.push(f.customer_id));
  if (f.site_id) (where.push('j.site_id = ?'), params.push(f.site_id));
  if (f.contract_id) (where.push('j.contract_id = ?'), params.push(f.contract_id));
  if (f.asset_id) (where.push('j.id IN (SELECT job_id FROM job_assets WHERE asset_id = ?)'), params.push(f.asset_id));
  if (f.engineer_id) (where.push(`j.id IN (SELECT job_id FROM visits WHERE engineer_id = ? AND status != 'cancelled')`), params.push(f.engineer_id));
  if (f.unscheduled) where.push(`j.status IN ('new','on_hold') AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.job_id = j.id AND v.status IN ('scheduled','accepted','travelling','on_site'))`);
  if (f.from) (where.push('j.created_at >= ?'), params.push(f.from));
  if (f.to) (where.push('j.created_at <= ?'), params.push(f.to));
  if (f.search) {
    const s = `%${f.search.trim()}%`;
    where.push('(j.job_no LIKE ? OR j.title LIKE ? OR j.description LIKE ? OR c.name LIKE ? OR s.name LIKE ? OR s.postcode LIKE ? OR j.customer_ref LIKE ?)');
    params.push(s, s, s, s, s, s, s);
  }
  const rows = q.all<Row>(
    `SELECT j.id, j.job_no, j.kind, j.priority, j.status, j.hold_reason, j.title, j.charge_type, j.created_at, j.respond_by, j.fix_by, j.attended_at,
            j.completed_at, j.due_on, j.target_start_on, j.est_hours, j.invoice_status, j.customer_ref, j.required_skills, j.ooh,
            c.id AS customer_id, c.name AS customer_name, s.id AS site_id, s.name AS site_name, s.postcode AS site_postcode, s.town AS site_town,
            ct.ref AS contract_ref,
            (SELECT MIN(v.starts_at) FROM visits v WHERE v.job_id = j.id AND v.status IN ('scheduled','accepted','travelling','on_site')) AS next_visit_at,
            (SELECT GROUP_CONCAT(DISTINCT e.name) FROM visits v JOIN engineers e ON e.id = v.engineer_id WHERE v.job_id = j.id AND v.status != 'cancelled') AS engineers
     FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN sites s ON s.id = j.site_id LEFT JOIN contracts ct ON ct.id = j.contract_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE WHEN j.status IN ('new','scheduled','in_progress','on_hold') THEN 0 ELSE 1 END, j.priority, COALESCE(j.respond_by, j.due_on, j.created_at)
     LIMIT ?`,
    ...params,
    f.limit,
  );
  let out = rows.map((r) => ({ ...r, required_skills: parseJson(r.required_skills, []), sla: slaState(r as any) }));
  if (f.sla) {
    out = out.filter((r) => {
      const states = [r.sla.response, r.sla.fix];
      if (f.sla === 'at_risk') return states.includes('at_risk');
      if (f.sla === 'breached') return OPEN_STATUSES.includes(r.status) && states.includes('breached');
      return OPEN_STATUSES.includes(r.status) && (states.includes('at_risk') || states.includes('breached'));
    });
  }
  return out;
}

export const JobPatch = z.object({
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.enum(['new', 'scheduled', 'in_progress', 'on_hold', 'completed', 'closed', 'cancelled']).optional(),
  hold_reason: z.enum(Object.keys(HOLD_REASONS) as [string, ...string[]]).optional().nullable(),
  title: z.string().min(3).optional(),
  description: z.string().optional().nullable(),
  customer_ref: z.string().optional().nullable(),
  nte_limit: z.number().optional().nullable(),
  charge_type: z.enum(['contract', 'chargeable', 'quoted', 'warranty', 'non_chargeable']).optional(),
  est_hours: z.number().positive().optional(),
  required_skills: z.array(z.string()).optional(),
  owner_id: z.number().int().optional().nullable(),
  cause: z.string().optional().nullable(),
  resolution: z.string().optional().nullable(),
  due_on: z.string().optional().nullable(),
  target_start_on: z.string().optional().nullable(),
  asset_ids: z.array(z.number().int()).optional(),
  reason: z.string().optional(), // free-text reason for audit (e.g. cancellation)
});

export function updateJob(actor: Actor, id: number, raw: z.input<typeof JobPatch>) {
  const patch = JobPatch.parse(raw);
  const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) throw notFound('Job');
  const changes: string[] = [];
  const data: Row = {};
  for (const key of ['title', 'description', 'customer_ref', 'nte_limit', 'charge_type', 'est_hours', 'owner_id', 'cause', 'resolution', 'due_on', 'target_start_on'] as const) {
    if (patch[key] !== undefined && patch[key] !== job[key]) {
      data[key] = patch[key];
      changes.push(`${key} → ${patch[key] ?? '—'}`);
    }
  }
  if (patch.required_skills) data.required_skills = JSON.stringify(patch.required_skills);
  if (patch.priority && patch.priority !== job.priority) {
    data.priority = patch.priority;
    changes.push(`priority ${job.priority} → ${patch.priority}`);
    if (['reactive', 'warranty', 'recall'].includes(job.kind)) {
      const t = slaTargets(job.contract_id, patch.priority, new Date(job.created_at));
      data.respond_by = t.respond_by;
      data.fix_by = t.fix_by;
    }
  }
  if (patch.status && patch.status !== job.status) {
    if (patch.status === 'on_hold' && !(patch.hold_reason ?? job.hold_reason)) throw badRequest('A hold reason is required when putting a job on hold');
    if (patch.status === 'closed' && !['completed'].includes(job.status)) throw badRequest('Only completed jobs can be closed');
    if (patch.status === 'cancelled') {
      q.run(`UPDATE visits SET status = 'cancelled' WHERE job_id = ? AND status IN ('scheduled','accepted')`, id);
    }
    data.status = patch.status;
    if (patch.status !== 'on_hold') data.hold_reason = null;
    if (patch.status === 'completed' && !job.completed_at) data.completed_at = nowIso();
    if (patch.status === 'closed') {
      data.closed_at = nowIso();
      if (job.invoice_status === 'not_ready' && ['chargeable', 'quoted'].includes(job.charge_type)) data.invoice_status = 'ready';
      if (job.charge_type === 'contract' && job.invoice_status === 'not_ready') data.invoice_status = 'not_chargeable';
    }
    changes.push(`status ${job.status} → ${patch.status}${patch.reason ? ` (${patch.reason})` : ''}`);
  }
  if (patch.hold_reason !== undefined && (patch.status ?? job.status) === 'on_hold') {
    data.hold_reason = patch.hold_reason;
    if (patch.hold_reason !== job.hold_reason) changes.push(`hold reason → ${HOLD_REASONS[patch.hold_reason ?? ''] ?? '—'}`);
  }
  q.tx(() => {
    if (Object.keys(data).length) update('jobs', id, { ...data, updated_at: nowIso() });
    if (patch.asset_ids) {
      q.run('DELETE FROM job_assets WHERE job_id = ?', id);
      for (const aid of patch.asset_ids) insert('job_assets', { job_id: id, asset_id: aid });
      changes.push(`equipment updated (${patch.asset_ids.length})`);
    }
    if (changes.length) {
      audit(actor, 'job', id, 'updated', changes.join('; '));
      addNote(actor, id, `Updated: ${changes.join('; ')}`, 'system');
    }
  });
  return getJob(id);
}

export function addNote(actor: Actor, jobId: number, body: string, kind: 'note' | 'engineer' | 'customer_update' | 'system' = 'note', visitId?: number) {
  return insert('job_notes', { job_id: jobId, visit_id: visitId ?? null, user_id: actor.userId, kind, body: actor.viaAi && kind !== 'system' ? `${body}` : body });
}

export const PartInput = z.object({
  part_id: z.number().int().optional().nullable(),
  description: z.string().optional(),
  qty: z.number().positive(),
  unit_cost: z.number().optional(),
  unit_price: z.number().optional(),
  location_id: z.number().int().optional().nullable(), // stock location to draw from
  visit_id: z.number().int().optional().nullable(),
});

export function addPart(actor: Actor, jobId: number, raw: z.input<typeof PartInput>) {
  const input = PartInput.parse(raw);
  const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw notFound('Job');
  let part: Row | undefined;
  if (input.part_id) {
    part = q.get<Row>('SELECT * FROM parts WHERE id = ?', input.part_id);
    if (!part) throw notFound('Part');
  }
  if (!part && !input.description) throw badRequest('Part or description required');
  const rates = getSetting('rates', DEFAULT_RATES);
  const unitCost = input.unit_cost ?? part?.unit_cost ?? 0;
  const unitPrice = input.unit_price ?? part?.sell_price ?? Math.round(unitCost * (1 + rates.materials_markup_pct / 100) * 100) / 100;
  return q.tx(() => {
    const id = insert('job_parts', {
      job_id: jobId,
      visit_id: input.visit_id ?? null,
      part_id: part?.id ?? null,
      description: part ? part.name : input.description,
      qty: input.qty,
      unit_cost: unitCost,
      unit_price: unitPrice,
      location_id: input.location_id ?? null,
      added_by: actor.userId,
    });
    if (part && input.location_id) {
      q.run(
        `INSERT INTO stock_levels (part_id, location_id, qty) VALUES (?, ?, ?) ON CONFLICT(part_id, location_id) DO UPDATE SET qty = qty - ?`,
        part.id,
        input.location_id,
        -input.qty,
        input.qty,
      );
      insert('stock_movements', { part_id: part.id, from_location_id: input.location_id, qty: input.qty, kind: 'job_use', job_id: jobId, user_id: actor.userId });
    }
    audit(actor, 'job', jobId, 'part_added', `${input.qty} × ${part?.name ?? input.description}`);
    return id;
  });
}

export function removePart(actor: Actor, jobId: number, jobPartId: number) {
  const jp = q.get<Row>('SELECT * FROM job_parts WHERE id = ? AND job_id = ?', jobPartId, jobId);
  if (!jp) throw notFound('Part line');
  q.tx(() => {
    if (jp.part_id && jp.location_id) {
      q.run('UPDATE stock_levels SET qty = qty + ? WHERE part_id = ? AND location_id = ?', jp.qty, jp.part_id, jp.location_id);
      insert('stock_movements', { part_id: jp.part_id, to_location_id: jp.location_id, qty: jp.qty, kind: 'return', job_id: jobId, user_id: actor.userId, note: 'Removed from job' });
    }
    q.run('DELETE FROM job_parts WHERE id = ?', jobPartId);
    audit(actor, 'job', jobId, 'part_removed', jp.description);
  });
}

export const DefectInput = z.object({
  asset_id: z.number().int().optional().nullable(),
  visit_id: z.number().int().optional().nullable(),
  severity: z.enum(['advisory', 'recommended', 'urgent', 'unsafe']),
  description: z.string().min(3),
  recommendation: z.string().optional().nullable(),
});

export function addDefect(actor: Actor, jobId: number, raw: z.input<typeof DefectInput>) {
  const input = DefectInput.parse(raw);
  const job = q.get<Row>('SELECT site_id FROM jobs WHERE id = ?', jobId);
  if (!job) throw notFound('Job');
  const id = insert('defects', { ...input, job_id: jobId, site_id: job.site_id, raised_by: actor.userId });
  if (input.asset_id && (input.severity === 'unsafe' || input.severity === 'urgent')) {
    update('assets', input.asset_id, { status: input.severity === 'unsafe' ? 'out_of_service' : 'faulty' });
  }
  audit(actor, 'job', jobId, 'defect_raised', `${input.severity}: ${input.description}`);
  return id;
}

export const RefrigerantInput = z.object({
  asset_id: z.number().int(),
  visit_id: z.number().int().optional().nullable(),
  action: z.enum(['leak_check', 'added', 'recovered']),
  qty_kg: z.number().min(0).default(0),
  leak_found: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

export function addRefrigerantLog(actor: Actor, jobId: number, raw: z.input<typeof RefrigerantInput>) {
  const input = RefrigerantInput.parse(raw);
  const asset = q.get<Row>('SELECT * FROM assets WHERE id = ?', input.asset_id);
  if (!asset) throw notFound('Asset');
  if (input.action === 'added' && asset.refrigerant?.toUpperCase() === 'R22') throw badRequest('R22 cannot be added to equipment — virgin and recycled HCFCs are banned.');
  const id = insert('refrigerant_logs', {
    ...input,
    leak_found: input.leak_found ? 1 : 0,
    job_id: jobId,
    engineer_id: actor.engineerId,
    logged_on: today(),
    refrigerant: asset.refrigerant,
  });
  if (input.action === 'leak_check') update('assets', asset.id, { last_leak_check_on: today() });
  audit(actor, 'asset', asset.id, 'refrigerant_' + input.action, `${input.qty_kg}kg ${asset.refrigerant}${input.leak_found ? ' — LEAK FOUND' : ''}`);
  return id;
}

export function markInvoiced(actor: Actor, jobId: number, invoice_ref: string, invoice_value?: number) {
  const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw notFound('Job');
  if (!['completed', 'closed'].includes(job.status)) throw badRequest('Job is not complete');
  update('jobs', jobId, { invoice_status: 'invoiced', invoice_ref, invoice_value: invoice_value ?? null, status: 'closed', closed_at: job.closed_at ?? nowIso(), updated_at: nowIso() });
  audit(actor, 'job', jobId, 'invoiced', `${invoice_ref}${invoice_value ? ` £${invoice_value}` : ''}`);
  return getJob(jobId);
}
