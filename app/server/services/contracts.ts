import { z } from 'zod';
import { q, insert, update, nextNumber, parseJson, type Row } from '../db/index.ts';
import { audit, badRequest, notFound, type Actor } from '../lib/context.ts';
import { addMonths, today } from '../lib/time.ts';
import { createJob } from './jobs.ts';

export function listContracts(opts: { status?: string; customer_id?: number; renewals_within_days?: number } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.status) (where.push('ct.status = ?'), p.push(opts.status));
  if (opts.customer_id) (where.push('ct.customer_id = ?'), p.push(opts.customer_id));
  if (opts.renewals_within_days) {
    where.push(`ct.status = 'active' AND ct.ends_on <= date('now', ?)`);
    p.push(`+${opts.renewals_within_days} days`);
  }
  return q.all(
    `SELECT ct.*, c.name AS customer_name, u.name AS account_manager_name,
       (SELECT COUNT(*) FROM contract_sites cs WHERE cs.contract_id = ct.id) AS site_count,
       (SELECT COUNT(*) FROM ppm_plans p WHERE p.contract_id = ct.id AND p.active = 1) AS plan_count,
       (SELECT MIN(next_due_on) FROM ppm_plans p WHERE p.contract_id = ct.id AND p.active = 1) AS next_ppm_due
     FROM contracts ct JOIN customers c ON c.id = ct.customer_id LEFT JOIN users u ON u.id = ct.account_manager_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ct.status, ct.ends_on`,
    ...p,
  );
}

export function getContract(id: number) {
  const ct = q.get<Row>('SELECT ct.*, c.name AS customer_name, u.name AS account_manager_name FROM contracts ct JOIN customers c ON c.id = ct.customer_id LEFT JOIN users u ON u.id = ct.account_manager_id WHERE ct.id = ?', id);
  if (!ct) throw notFound('Contract');
  ct.sla = q.all('SELECT * FROM contract_sla WHERE contract_id = ? ORDER BY priority', id);
  ct.sites = q.all('SELECT s.id, s.name, s.postcode, s.town, (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id AND a.status != \'decommissioned\') AS asset_count FROM sites s JOIN contract_sites cs ON cs.site_id = s.id WHERE cs.contract_id = ? ORDER BY s.name', id);
  ct.plans = listPpmPlans({ contract_id: id });
  const since = ct.starts_on;
  ct.performance = q.get(
    `SELECT COUNT(*) AS jobs,
       SUM(CASE WHEN kind = 'reactive' THEN 1 ELSE 0 END) AS reactive,
       SUM(CASE WHEN kind = 'ppm' THEN 1 ELSE 0 END) AS ppm,
       SUM(CASE WHEN kind = 'ppm' AND status IN ('completed','closed') THEN 1 ELSE 0 END) AS ppm_done,
       SUM(CASE WHEN kind = 'reactive' AND attended_at IS NOT NULL AND respond_by IS NOT NULL AND attended_at <= respond_by THEN 1 ELSE 0 END) AS responded_in_sla,
       SUM(CASE WHEN kind = 'reactive' AND attended_at IS NOT NULL AND respond_by IS NOT NULL THEN 1 ELSE 0 END) AS responded,
       (SELECT COALESCE(SUM(jp.qty*jp.unit_cost),0) FROM job_parts jp JOIN jobs j2 ON j2.id = jp.job_id WHERE j2.contract_id = ? AND j2.created_at >= ?) AS parts_cost
     FROM jobs WHERE contract_id = ? AND created_at >= ?`,
    id,
    since,
    id,
    since,
  );
  ct.recent_jobs = q.all('SELECT j.id, j.job_no, j.kind, j.status, j.title, j.priority, j.created_at, s.name AS site_name FROM jobs j JOIN sites s ON s.id = j.site_id WHERE j.contract_id = ? ORDER BY j.created_at DESC LIMIT 25', id);
  return ct;
}

export const ContractInput = z.object({
  customer_id: z.number().int(),
  name: z.string().min(3),
  level: z.enum(['ppm_only', 'ppm_reactive', 'comprehensive']),
  status: z.enum(['draft', 'active', 'expired', 'cancelled']).default('active'),
  starts_on: z.string(),
  ends_on: z.string(),
  annual_value: z.number().default(0),
  billing_cycle: z.enum(['monthly', 'quarterly', 'annually']).default('quarterly'),
  ooh_cover: z.boolean().default(false),
  labour_included: z.boolean().default(false),
  parts_included: z.boolean().default(false),
  parts_limit: z.number().optional().nullable(),
  auto_renew: z.boolean().default(false),
  notice_days: z.number().int().default(90),
  account_manager_id: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
  site_ids: z.array(z.number().int()).default([]),
  sla: z
    .array(z.object({ priority: z.enum(['P1', 'P2', 'P3', 'P4']), response_hours: z.number(), fix_hours: z.number().nullable().optional(), basis: z.enum(['business', '24x7']) }))
    .default([]),
});

export function createContract(actor: Actor, raw: z.input<typeof ContractInput>) {
  const { site_ids, sla, ...input } = ContractInput.parse(raw);
  if (input.ends_on <= input.starts_on) throw badRequest('Contract must end after it starts');
  const id = q.tx(() => {
    const cid = insert('contracts', { ...input, ref: nextNumber('contract', 'MC-', 4) });
    for (const s of site_ids) insert('contract_sites', { contract_id: cid, site_id: s });
    for (const t of sla) insert('contract_sla', { contract_id: cid, ...t, fix_hours: t.fix_hours ?? null });
    audit(actor, 'contract', cid, 'created', input.name);
    return cid;
  });
  return getContract(id);
}

export function updateContract(actor: Actor, id: number, raw: Partial<z.input<typeof ContractInput>>) {
  const { site_ids, sla, ...input } = ContractInput.partial().parse(raw);
  if (!q.get('SELECT id FROM contracts WHERE id = ?', id)) throw notFound('Contract');
  q.tx(() => {
    update('contracts', id, input);
    if (site_ids) {
      q.run('DELETE FROM contract_sites WHERE contract_id = ?', id);
      for (const s of site_ids) insert('contract_sites', { contract_id: id, site_id: s });
    }
    if (sla) {
      q.run('DELETE FROM contract_sla WHERE contract_id = ?', id);
      for (const t of sla) insert('contract_sla', { contract_id: id, ...t, fix_hours: t.fix_hours ?? null });
    }
    audit(actor, 'contract', id, 'updated');
  });
  return getContract(id);
}

// ─── PPM ──────────────────────────────────────────────────────────────────

export function listPpmPlans(opts: { contract_id?: number; due_before?: string; site_id?: number } = {}) {
  const where = ['p.active = 1'];
  const p: unknown[] = [];
  if (opts.contract_id) (where.push('p.contract_id = ?'), p.push(opts.contract_id));
  if (opts.site_id) (where.push('p.site_id = ?'), p.push(opts.site_id));
  if (opts.due_before) (where.push('p.next_due_on <= ?'), p.push(opts.due_before));
  return q
    .all<Row>(
      `SELECT p.*, s.name AS site_name, s.postcode, ct.ref AS contract_ref, ct.status AS contract_status, c.name AS customer_name, e.name AS preferred_engineer_name,
         t.name AS checklist_name,
         (SELECT COUNT(*) FROM ppm_plan_assets pa WHERE pa.plan_id = p.id) AS asset_count,
         (SELECT j.id FROM jobs j WHERE j.ppm_plan_id = p.id AND j.due_on = p.next_due_on AND j.status != 'cancelled' LIMIT 1) AS generated_job_id,
         (SELECT j.job_no FROM jobs j WHERE j.ppm_plan_id = p.id AND j.due_on = p.next_due_on AND j.status != 'cancelled' LIMIT 1) AS generated_job_no
       FROM ppm_plans p JOIN sites s ON s.id = p.site_id JOIN contracts ct ON ct.id = p.contract_id JOIN customers c ON c.id = ct.customer_id
       LEFT JOIN engineers e ON e.id = p.preferred_engineer_id LEFT JOIN checklist_templates t ON t.id = p.checklist_template_id
       WHERE ${where.join(' AND ')} ORDER BY p.next_due_on`,
      ...p,
    )
    .map((r) => ({ ...r, required_skills: parseJson(r.required_skills, []) }));
}

/**
 * Create PPM jobs for every active plan falling due on or before `until` that doesn't already have a job for that
 * due date. The job's window runs from 14 days before the due date to the due date. Once a job is generated the plan
 * rolls forward to its next due date.
 */
export function generatePpmJobs(actor: Actor, until: string) {
  const plans = listPpmPlans({ due_before: until }).filter((p) => p.contract_status === 'active');
  const created: Row[] = [];
  for (const plan of plans) {
    let due = plan.next_due_on as string;
    let guard = 0;
    while (due <= until && guard++ < 12) {
      const exists = q.get('SELECT id FROM jobs WHERE ppm_plan_id = ? AND due_on = ? AND status != ?', plan.id, due, 'cancelled');
      if (!exists) {
        const assetIds = q.all<{ asset_id: number }>('SELECT asset_id FROM ppm_plan_assets WHERE plan_id = ?', plan.id).map((a) => a.asset_id);
        const windowStart = addMonths(due, 0) > today() ? isoMinusDays(due, 14) : today();
        const { job } = createJob(actor, {
          site_id: plan.site_id,
          kind: 'ppm',
          priority: 'P4',
          title: plan.name,
          description: `Planned maintenance under ${plan.contract_ref}. ${plan.frequency_months}-monthly visit covering ${assetIds.length} item(s) of equipment.${plan.scheduling_notes ? `\nScheduling: ${plan.scheduling_notes}` : ''}`,
          reported_via: 'ppm_schedule',
          asset_ids: assetIds,
          required_skills: plan.required_skills,
          est_hours: plan.est_hours,
          target_start_on: windowStart,
          due_on: due,
          ppm_plan_id: plan.id,
        });
        created.push({ id: job.id, job_no: job.job_no, site_name: plan.site_name, due_on: due, title: plan.name });
      }
      due = addMonths(due, plan.frequency_months);
    }
    update('ppm_plans', plan.id, { next_due_on: due });
  }
  return { created, plans_checked: plans.length };
}

function isoMinusDays(date: string, days: number) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const PpmPlanInput = z.object({
  contract_id: z.number().int(),
  site_id: z.number().int(),
  name: z.string().min(3),
  frequency_months: z.number().int().min(1).max(24),
  est_hours: z.number().positive().default(2),
  engineers_required: z.number().int().min(1).default(1),
  required_skills: z.array(z.string()).default([]),
  checklist_template_id: z.number().int().optional().nullable(),
  next_due_on: z.string(),
  preferred_engineer_id: z.number().int().optional().nullable(),
  scheduling_notes: z.string().optional().nullable(),
  asset_ids: z.array(z.number().int()).default([]),
});

export function createPpmPlan(actor: Actor, raw: z.input<typeof PpmPlanInput>) {
  const { asset_ids, ...input } = PpmPlanInput.parse(raw);
  const id = q.tx(() => {
    const pid = insert('ppm_plans', input);
    for (const a of asset_ids) insert('ppm_plan_assets', { plan_id: pid, asset_id: a });
    audit(actor, 'contract', input.contract_id, 'ppm_plan_added', input.name);
    return pid;
  });
  return q.get('SELECT * FROM ppm_plans WHERE id = ?', id);
}

export function ppmCompliance() {
  // PPM jobs past their due date and not complete
  return q.all(
    `SELECT j.id, j.job_no, j.title, j.status, j.due_on, s.name AS site_name, c.name AS customer_name,
       (SELECT MIN(v.starts_at) FROM visits v WHERE v.job_id = j.id AND v.status IN ('scheduled','accepted')) AS next_visit_at
     FROM jobs j JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = j.customer_id
     WHERE j.kind = 'ppm' AND j.status IN ('new','scheduled','on_hold','in_progress') ORDER BY j.due_on`,
  );
}
