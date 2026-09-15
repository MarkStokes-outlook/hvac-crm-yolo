import { z } from 'zod';
import { q, insert, update, parseJson, type Row } from '../db/index.ts';
import { audit, badRequest, forbidden, notFound, type Actor } from '../lib/context.ts';
import { qualificationState } from '../lib/compliance.ts';
import { DEPOT, travelMinutes, type LatLng } from '../lib/geo.ts';
import { addDays, at, isWorkingDay, nowIso, parseYmd, today, ymd } from '../lib/time.ts';
import { addNote, getJob } from './jobs.ts';
import { slaState } from './sla.ts';

const ACTIVE_VISIT = `('scheduled','accepted','travelling','on_site')`;
const REFRIGERANT_SKILLS = ['ac', 'vrf', 'refrigeration', 'heat_pumps', 'chillers'];

export function listEngineers(opts: { includeInactive?: boolean } = {}) {
  return q
    .all<Row>(`SELECT e.*, sl.id AS van_location_id FROM engineers e LEFT JOIN stock_locations sl ON sl.engineer_id = e.id AND sl.kind = 'van' ${opts.includeInactive ? '' : 'WHERE e.active = 1'} ORDER BY e.team, e.name`)
    .map((e) => ({
      ...e,
      skills: parseJson<string[]>(e.skills, []),
      qualifications: q.all<Row>('SELECT * FROM engineer_qualifications WHERE engineer_id = ? ORDER BY name', e.id).map((qq) => ({ ...qq, state: qualificationState(qq.expires_on) })),
    }));
}

export function getEngineer(id: number) {
  const e = listEngineers({ includeInactive: true }).find((x) => x.id === id);
  if (!e) throw notFound('Engineer');
  return {
    ...e,
    absences: q.all('SELECT * FROM absences WHERE engineer_id = ? AND ends_at >= ? ORDER BY starts_at', id, nowIso()),
    upcoming: q.all(
      `SELECT v.*, j.job_no, j.title, j.priority, j.kind, s.name AS site_name, s.postcode FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id
       WHERE v.engineer_id = ? AND v.starts_at >= ? AND v.status != 'cancelled' ORDER BY v.starts_at LIMIT 30`,
      id,
      at(today(), '00:00').toISOString(),
    ),
    recent: q.all(
      `SELECT v.*, j.job_no, j.title, s.name AS site_name FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id
       WHERE v.engineer_id = ? AND v.status IN ('completed','incomplete') ORDER BY v.starts_at DESC LIMIT 15`,
      id,
    ),
  };
}

/** Schedule board data: engineers × visits × absences over a date range. */
export function scheduleBoard(from: string, to: string) {
  const start = at(from, '00:00').toISOString();
  const end = at(to, '23:59').toISOString();
  const engineers = listEngineers().map(({ qualifications, ...e }) => e);
  const visits = q.all<Row>(
    `SELECT v.*, j.job_no, j.title, j.priority, j.kind, j.status AS job_status, j.respond_by, j.attended_at, j.created_at AS job_created_at, j.completed_at, j.fix_by,
            s.name AS site_name, s.postcode, s.town, c.name AS customer_name
     FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = j.customer_id
     WHERE v.starts_at < ? AND v.ends_at > ? AND v.status != 'cancelled' ORDER BY v.starts_at`,
    end,
    start,
  );
  const absences = q.all('SELECT * FROM absences WHERE starts_at < ? AND ends_at > ?', end, start);
  const onCall = q.all('SELECT * FROM on_call WHERE starts_on <= ? AND ends_on >= ?', to, from);
  return { from, to, engineers, visits, absences, on_call: onCall };
}

export const VisitInput = z.object({
  job_id: z.number().int(),
  engineer_id: z.number().int(),
  starts_at: z.string(), // ISO
  ends_at: z.string().optional(),
  duration_hours: z.number().positive().optional(),
  instructions: z.string().optional().nullable(),
  force: z.boolean().optional(), // book despite clashes
});

export function findClashes(engineerId: number, startsAt: Date, endsAt: Date, ignoreVisitId?: number) {
  const visits = q.all<Row>(
    `SELECT v.id, v.starts_at, v.ends_at, j.job_no, s.name AS site_name FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id
     WHERE v.engineer_id = ? AND v.status IN ${ACTIVE_VISIT} AND v.starts_at < ? AND v.ends_at > ? AND v.id != ?`,
    engineerId,
    endsAt.toISOString(),
    startsAt.toISOString(),
    ignoreVisitId ?? -1,
  );
  const absences = q.all<Row>('SELECT * FROM absences WHERE engineer_id = ? AND starts_at < ? AND ends_at > ?', engineerId, endsAt.toISOString(), startsAt.toISOString());
  const msgs = [
    ...visits.map((v) => `already booked on ${v.job_no} at ${v.site_name} (${fmtTime(v.starts_at)}–${fmtTime(v.ends_at)})`),
    ...absences.map((a) => `absent (${a.kind})`),
  ];
  return msgs;
}

const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (s: string | Date) => new Date(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function scheduleVisit(actor: Actor, raw: z.input<typeof VisitInput>) {
  const input = VisitInput.parse(raw);
  const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', input.job_id);
  if (!job) throw notFound('Job');
  if (['completed', 'closed', 'cancelled'].includes(job.status)) throw badRequest(`Job ${job.job_no} is ${job.status}`);
  const eng = q.get<Row>('SELECT * FROM engineers WHERE id = ? AND active = 1', input.engineer_id);
  if (!eng) throw notFound('Engineer');
  const startsAt = new Date(input.starts_at);
  if (Number.isNaN(startsAt.getTime())) throw badRequest('Invalid start time');
  const endsAt = input.ends_at ? new Date(input.ends_at) : new Date(startsAt.getTime() + (input.duration_hours ?? job.est_hours ?? 2) * 3600_000);
  if (endsAt <= startsAt) throw badRequest('Visit must end after it starts');
  const clashes = findClashes(eng.id, startsAt, endsAt);
  if (clashes.length && !input.force) throw badRequest(`${eng.name} is ${clashes.join('; ')}. Choose another time or book anyway (force).`);

  const id = q.tx(() => {
    const visitId = insert('visits', {
      job_id: job.id,
      engineer_id: eng.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'scheduled',
      instructions: input.instructions ?? null,
      created_by: actor.userId,
    });
    if (['new', 'on_hold'].includes(job.status)) update('jobs', job.id, { status: 'scheduled', hold_reason: null, updated_at: nowIso() });
    addNote(actor, job.id, `Visit booked: ${eng.name}, ${fmtDateTime(startsAt)}–${fmtTime(endsAt.toISOString())}${clashes.length ? ' (booked over clash)' : ''}`, 'system');
    audit(actor, 'job', job.id, 'visit_scheduled', `${eng.name} ${startsAt.toISOString()}`);
    return visitId;
  });
  return { visit: getVisit(id), clashes };
}

export const VisitPatch = z.object({
  engineer_id: z.number().int().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  instructions: z.string().optional().nullable(),
  force: z.boolean().optional(),
});

export function rescheduleVisit(actor: Actor, visitId: number, raw: z.input<typeof VisitPatch>) {
  const input = VisitPatch.parse(raw);
  const v = q.get<Row>('SELECT * FROM visits WHERE id = ?', visitId);
  if (!v) throw notFound('Visit');
  if (!['scheduled', 'accepted'].includes(v.status)) throw badRequest(`Visit is ${v.status} and cannot be moved`);
  const engineerId = input.engineer_id ?? v.engineer_id;
  const startsAt = new Date(input.starts_at ?? v.starts_at);
  const duration = new Date(v.ends_at).getTime() - new Date(v.starts_at).getTime();
  const endsAt = input.ends_at ? new Date(input.ends_at) : new Date(startsAt.getTime() + duration);
  const clashes = findClashes(engineerId, startsAt, endsAt, visitId);
  const eng = q.get<Row>('SELECT name FROM engineers WHERE id = ?', engineerId);
  if (!eng) throw notFound('Engineer');
  if (clashes.length && !input.force) throw badRequest(`${eng.name} is ${clashes.join('; ')}.`);
  update('visits', visitId, {
    engineer_id: engineerId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    instructions: input.instructions,
    status: engineerId !== v.engineer_id ? 'scheduled' : v.status,
  });
  addNote(actor, v.job_id, `Visit moved to ${eng.name}, ${fmtDateTime(startsAt)}`, 'system');
  audit(actor, 'job', v.job_id, 'visit_rescheduled', `${eng.name} ${startsAt.toISOString()}`);
  return { visit: getVisit(visitId), clashes };
}

export function cancelVisit(actor: Actor, visitId: number, reason?: string) {
  const v = q.get<Row>('SELECT * FROM visits WHERE id = ?', visitId);
  if (!v) throw notFound('Visit');
  if (!['scheduled', 'accepted', 'travelling'].includes(v.status)) throw badRequest(`Visit is ${v.status}`);
  q.tx(() => {
    update('visits', visitId, { status: 'cancelled' });
    const remaining = q.get<{ n: number }>(`SELECT COUNT(*) n FROM visits WHERE job_id = ? AND status IN ${ACTIVE_VISIT}`, v.job_id)!.n;
    const job = q.get<Row>('SELECT status FROM jobs WHERE id = ?', v.job_id)!;
    if (!remaining && job.status === 'scheduled') update('jobs', v.job_id, { status: 'new', updated_at: nowIso() });
    addNote(actor, v.job_id, `Visit on ${fmtDateTime(v.starts_at)} cancelled${reason ? `: ${reason}` : ''}`, 'system');
    audit(actor, 'job', v.job_id, 'visit_cancelled', reason);
  });
}

export function getVisit(id: number) {
  const v = q.get<Row>(
    `SELECT v.*, e.name AS engineer_name, j.job_no, j.title, j.priority, j.kind, s.name AS site_name
     FROM visits v JOIN engineers e ON e.id = v.engineer_id JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id WHERE v.id = ?`,
    id,
  );
  if (!v) throw notFound('Visit');
  return v;
}

// ─── Engineer workflow ────────────────────────────────────────────────────

function ownVisit(actor: Actor, visitId: number) {
  const v = q.get<Row>('SELECT * FROM visits WHERE id = ?', visitId);
  if (!v) throw notFound('Visit');
  if (actor.role === 'engineer' && v.engineer_id !== actor.engineerId) throw forbidden('This visit is not assigned to you');
  return v;
}

export function myVisits(actor: Actor, date?: string) {
  if (!actor.engineerId) return [];
  const from = at(date ?? today(), '00:00');
  const to = addDays(from, date ? 1 : 14);
  return q.all<Row>(
    `SELECT v.*, j.job_no, j.title, j.description, j.priority, j.kind, j.status AS job_status, j.respond_by, j.charge_type,
            s.name AS site_name, s.address, s.town, s.postcode, s.lat, s.lng, c.name AS customer_name
     FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = j.customer_id
     WHERE v.engineer_id = ? AND ((v.starts_at >= ? AND v.starts_at < ?) OR v.status IN ('travelling','on_site')) AND v.status != 'cancelled'
     ORDER BY v.starts_at`,
    actor.engineerId,
    from.toISOString(),
    to.toISOString(),
  );
}

export function visitDetail(actor: Actor, visitId: number) {
  const v = ownVisit(actor, visitId);
  const job = getJob(v.job_id);
  const siteHistory = q.all(
    `SELECT j.id, j.job_no, j.title, j.kind, j.completed_at, j.resolution,
            (SELECT GROUP_CONCAT(vv.work_summary, ' | ') FROM visits vv WHERE vv.job_id = j.id AND vv.work_summary IS NOT NULL) AS work_summaries
     FROM jobs j WHERE j.site_id = ? AND j.id != ? AND j.status IN ('completed','closed') ORDER BY j.completed_at DESC LIMIT 8`,
    job.site_id,
    job.id,
  );
  const siteAssets = q.all('SELECT id, tag, category, manufacturer, model, location, refrigerant, refrigerant_kg, status FROM assets WHERE site_id = ? AND status != ? ORDER BY tag', job.site_id, 'decommissioned');
  const openDefects = q.all(`SELECT d.*, a.tag AS asset_tag FROM defects d LEFT JOIN assets a ON a.id = d.asset_id WHERE d.site_id = ? AND d.status IN ('open','quoted') ORDER BY d.created_at DESC`, job.site_id);
  const contacts = q.all('SELECT * FROM contacts WHERE (site_id = ? OR (customer_id = ? AND site_id IS NULL AND is_primary = 1)) AND active = 1', job.site_id, job.customer_id);
  const vanStock = actor.engineerId
    ? q.all(`SELECT p.id AS part_id, p.sku, p.name, sl.qty, sl.location_id FROM stock_levels sl JOIN parts p ON p.id = sl.part_id JOIN stock_locations l ON l.id = sl.location_id WHERE l.engineer_id = ? AND sl.qty > 0 ORDER BY p.name`, v.engineer_id)
    : [];
  let checklistTemplate = null;
  if (job.ppm_plan_id) {
    checklistTemplate = q.get<Row>('SELECT t.* FROM ppm_plans p JOIN checklist_templates t ON t.id = p.checklist_template_id WHERE p.id = ?', job.ppm_plan_id);
    if (checklistTemplate) checklistTemplate.items = parseJson(checklistTemplate.items, []);
  }
  return { visit: v, job, site_history: siteHistory, site_assets: siteAssets, open_defects: openDefects, contacts, van_stock: vanStock, checklist_template: checklistTemplate };
}

export function visitAction(actor: Actor, visitId: number, action: 'accept' | 'travel' | 'arrive') {
  const v = ownVisit(actor, visitId);
  const now = nowIso();
  const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', v.job_id)!;
  q.tx(() => {
    if (action === 'accept') {
      if (v.status !== 'scheduled') throw badRequest('Visit already accepted');
      update('visits', visitId, { status: 'accepted' });
    } else if (action === 'travel') {
      if (!['scheduled', 'accepted'].includes(v.status)) throw badRequest(`Visit is ${v.status}`);
      update('visits', visitId, { status: 'travelling', travel_started_at: now });
      addNote(actor, v.job_id, 'Engineer en route', 'system', visitId);
    } else if (action === 'arrive') {
      if (!['scheduled', 'accepted', 'travelling'].includes(v.status)) throw badRequest(`Visit is ${v.status}`);
      update('visits', visitId, { status: 'on_site', arrived_at: now });
      update('jobs', v.job_id, { status: 'in_progress', attended_at: job.attended_at ?? now, hold_reason: null, updated_at: now });
      addNote(actor, v.job_id, 'Engineer arrived on site', 'system', visitId);
    }
    audit(actor, 'job', v.job_id, `visit_${action}`);
  });
  return getVisit(visitId);
}

export const CompleteVisitInput = z.object({
  outcome: z.enum(['fixed', 'temporary_fix', 'further_visit', 'parts_required', 'quote_required', 'no_access', 'no_fault_found', 'ppm_complete']),
  work_summary: z.string().min(3),
  cause: z.string().optional().nullable(),
  signed_by: z.string().optional().nullable(),
  signature: z.string().optional().nullable(),
  asset_status: z.record(z.string(), z.enum(['operational', 'faulty', 'out_of_service'])).optional(),
});

export function completeVisit(actor: Actor, visitId: number, raw: z.input<typeof CompleteVisitInput>) {
  const input = CompleteVisitInput.parse(raw);
  const v = ownVisit(actor, visitId);
  if (!['on_site', 'travelling', 'accepted', 'scheduled'].includes(v.status)) throw badRequest(`Visit is ${v.status}`);
  const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', v.job_id)!;
  const now = nowIso();
  const finished = ['fixed', 'no_fault_found', 'ppm_complete'].includes(input.outcome);
  q.tx(() => {
    update('visits', visitId, {
      status: finished ? 'completed' : 'incomplete',
      arrived_at: v.arrived_at ?? v.starts_at,
      departed_at: now,
      outcome: input.outcome,
      work_summary: input.work_summary,
      signed_by: input.signed_by ?? null,
      signature: input.signature ?? null,
    });
    const jobData: Row = { updated_at: now, attended_at: job.attended_at ?? v.arrived_at ?? now };
    if (input.cause) jobData.cause = input.cause;
    if (finished) {
      const otherOpen = q.get<{ n: number }>(`SELECT COUNT(*) n FROM visits WHERE job_id = ? AND id != ? AND status IN ${ACTIVE_VISIT}`, job.id, visitId)!.n;
      if (!otherOpen) {
        Object.assign(jobData, { status: 'completed', completed_at: now, resolution: input.work_summary, hold_reason: null });
      }
    } else {
      const holdMap: Record<string, string | null> = {
        parts_required: 'awaiting_parts',
        quote_required: 'awaiting_quote_approval',
        no_access: 'awaiting_access',
        temporary_fix: null,
        further_visit: null,
      };
      const hold = holdMap[input.outcome];
      Object.assign(jobData, hold ? { status: 'on_hold', hold_reason: hold } : { status: 'new', hold_reason: null });
    }
    update('jobs', job.id, jobData);
    for (const [assetId, status] of Object.entries(input.asset_status ?? {})) update('assets', Number(assetId), { status });
    if (job.kind === 'ppm' && finished) {
      q.run(`UPDATE assets SET last_serviced_on = ? WHERE id IN (SELECT asset_id FROM job_assets WHERE job_id = ?)`, today(), job.id);
    }
    addNote(actor, job.id, `Visit completed — ${input.outcome.replace(/_/g, ' ')}: ${input.work_summary}`, 'engineer', visitId);
    audit(actor, 'job', job.id, 'visit_completed', input.outcome);
  });
  return getJob(job.id);
}

export function saveChecklist(actor: Actor, visitId: number, body: { asset_id?: number | null; template_id?: number | null; responses: Record<string, unknown> }) {
  ownVisit(actor, visitId);
  const existing = q.get<Row>('SELECT id FROM visit_checklists WHERE visit_id = ? AND COALESCE(asset_id, 0) = ?', visitId, body.asset_id ?? 0);
  if (existing) update('visit_checklists', existing.id, { responses: body.responses, updated_at: nowIso() });
  else insert('visit_checklists', { visit_id: visitId, asset_id: body.asset_id ?? null, template_id: body.template_id ?? null, responses: body.responses });
}

// ─── Availability & recommendations ───────────────────────────────────────

interface Busy {
  start: Date;
  end: Date;
  loc: LatLng | null;
  label: string;
}

function busyBlocks(engineerId: number, day: string): Busy[] {
  const s = at(day, '00:00').toISOString();
  const e = at(day, '23:59').toISOString();
  const visits = q.all<Row>(
    `SELECT v.starts_at, v.ends_at, s.lat, s.lng, j.job_no, s.name AS site_name FROM visits v JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id
     WHERE v.engineer_id = ? AND v.status IN ${ACTIVE_VISIT} AND v.starts_at < ? AND v.ends_at > ? ORDER BY v.starts_at`,
    engineerId,
    e,
    s,
  ).map((r) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at), loc: r.lat ? { lat: r.lat, lng: r.lng } : DEPOT, label: `${r.job_no} ${r.site_name}` }));
  const abs = q.all<Row>('SELECT * FROM absences WHERE engineer_id = ? AND starts_at < ? AND ends_at > ?', engineerId, e, s).map((a) => ({
    start: new Date(a.starts_at),
    end: new Date(a.ends_at),
    loc: null,
    label: a.kind,
  }));
  return [...visits, ...abs].sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function engineerAvailability(engineerId: number, day: string) {
  const eng = q.get<Row>('SELECT * FROM engineers WHERE id = ?', engineerId);
  if (!eng) throw notFound('Engineer');
  const dayStart = at(day, eng.day_start);
  const dayEnd = at(day, eng.day_end);
  const busy = busyBlocks(engineerId, day);
  const free: { start: string; end: string; hours: number }[] = [];
  let cursor = dayStart;
  if (isWorkingDay(parseYmd(day))) {
    for (const b of busy) {
      if (b.start > cursor) free.push({ start: cursor.toISOString(), end: new Date(Math.min(b.start.getTime(), dayEnd.getTime())).toISOString(), hours: 0 });
      if (b.end > cursor) cursor = b.end;
    }
    if (cursor < dayEnd) free.push({ start: cursor.toISOString(), end: dayEnd.toISOString(), hours: 0 });
  }
  const slots = free
    .map((f) => ({ ...f, hours: Math.round(((new Date(f.end).getTime() - new Date(f.start).getTime()) / 3600_000) * 10) / 10 }))
    .filter((f) => f.hours >= 0.5);
  const bookedHours = busy.reduce((s, b) => s + (Math.min(b.end.getTime(), dayEnd.getTime()) - Math.max(b.start.getTime(), dayStart.getTime())) / 3600_000, 0);
  return {
    engineer_id: engineerId,
    engineer_name: eng.name,
    date: day,
    working_day: isWorkingDay(parseYmd(day)),
    hours: `${eng.day_start}–${eng.day_end}`,
    booked: busy.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), label: b.label })),
    free_slots: slots,
    booked_hours: Math.max(0, Math.round(bookedHours * 10) / 10),
  };
}

export const SuggestInput = z.object({
  job_id: z.number().int().optional(),
  site_id: z.number().int().optional(),
  required_skills: z.array(z.string()).optional(),
  est_hours: z.number().optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  from_date: z.string().optional(),
  days: z.number().int().min(1).max(21).default(7),
  limit: z.number().int().min(1).max(20).default(5),
});

export interface Suggestion {
  engineer_id: number;
  engineer_name: string;
  grade: string;
  kind: string;
  score: number;
  slot_start: string;
  slot_end: string;
  travel_minutes: number | null;
  travel_from: string;
  meets_sla: boolean | null;
  skills_match: 'full' | 'partial';
  site_visits_12m: number;
  booked_hours_that_day: number;
  reasons: string[];
  warnings: string[];
}

/**
 * Rank engineers for a job: skills and tickets, earliest realistic arrival (including travel from the previous job
 * or home), SLA deadline, continuity at the site, and workload balance.
 */
export function suggestEngineers(raw: z.input<typeof SuggestInput>) {
  const input = SuggestInput.parse(raw);
  let site: Row | undefined;
  let skills = input.required_skills ?? [];
  let estHours = input.est_hours ?? 2;
  let priority = input.priority ?? 'P3';
  let respondBy: Date | null = null;
  let job: Row | undefined;
  if (input.job_id) {
    job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', input.job_id);
    if (!job) throw notFound('Job');
    site = q.get<Row>('SELECT * FROM sites WHERE id = ?', job.site_id);
    skills = input.required_skills ?? parseJson(job.required_skills, []);
    estHours = input.est_hours ?? job.est_hours;
    priority = job.priority;
    respondBy = job.respond_by ? new Date(job.respond_by) : null;
  } else if (input.site_id) {
    site = q.get<Row>('SELECT * FROM sites WHERE id = ?', input.site_id);
  }
  if (!site) throw badRequest('job_id or site_id required');
  const siteLoc = site.lat ? { lat: site.lat, lng: site.lng } : null;
  const needsFgas = skills.some((s) => REFRIGERANT_SKILLS.includes(s));
  const needsGas = skills.includes('gas');

  const now = new Date();
  const startDay = input.from_date ?? today();
  const out: Suggestion[] = [];

  for (const eng of listEngineers()) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const engSkills: string[] = eng.skills;
    const missing = skills.filter((s) => !engSkills.includes(s));
    if (skills.length && missing.length === skills.length) continue; // no relevant skills
    if (eng.grade === 'apprentice') continue; // apprentices do not attend alone
    const quals = new Map(eng.qualifications.map((x: Row) => [x.code, x.state]));
    if (needsFgas && !['valid', 'expiring', 'no_expiry'].includes(String(quals.get('FGAS_CAT1')))) continue;
    if (needsGas && !['valid', 'expiring', 'no_expiry'].includes(String(quals.get('GAS_SAFE_COMM')))) continue;
    if (site.dbs_required && !quals.has('DBS')) continue;
    if (missing.length) warnings.push(`Missing skills: ${missing.join(', ')}`);
    if (needsFgas && quals.get('FGAS_CAT1') === 'expiring') warnings.push('F-Gas certificate expiring soon');
    if (eng.team === 'installation' && job?.kind === 'reactive') warnings.push('Installation team engineer');

    // Find earliest slot within the horizon
    let found: { start: Date; end: Date; travel: number | null; from: string; bookedHours: number } | null = null;
    for (let d = 0; d < input.days && !found; d++) {
      const day = ymd(addDays(parseYmd(startDay), d));
      if (!isWorkingDay(parseYmd(day))) continue;
      const dayStart = at(day, eng.day_start);
      const dayEnd = at(day, eng.day_end);
      if (dayEnd <= now) continue;
      const busy = busyBlocks(eng.id, day);
      if (busy.some((b) => b.loc === null && b.start <= dayStart && b.end >= dayEnd)) continue; // absent all day
      const bookedHours = busy.filter((b) => b.loc).reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 3600_000, 0);
      // Walk the gaps
      let prevEnd = dayStart;
      let prevLoc: LatLng | null = eng.home_lat ? { lat: eng.home_lat, lng: eng.home_lng } : DEPOT;
      let prevLabel = 'home';
      const floorNow = new Date(Math.ceil((now.getTime() + 15 * 60_000) / (15 * 60_000)) * 15 * 60_000);
      const gaps = [...busy, { start: dayEnd, end: dayEnd, loc: null, label: 'end' }];
      for (const b of gaps) {
        const travel = travelMinutes(prevLoc, siteLoc) ?? 30;
        let start = new Date(Math.max(prevEnd.getTime() + (prevLabel === 'home' ? 0 : travel * 60_000), floorNow.getTime()));
        if (prevLabel === 'home' && start.getTime() === dayStart.getTime()) start = new Date(dayStart.getTime() + Math.max(0, travel - 30) * 60_000); // engineers travel to first job in their own time up to 30 min
        start = new Date(Math.ceil(start.getTime() / (15 * 60_000)) * 15 * 60_000);
        const end = new Date(start.getTime() + estHours * 3600_000);
        const nextTravel = b.loc ? (travelMinutes(siteLoc, b.loc) ?? 30) : 0;
        const limit = b.label === 'end' ? dayEnd.getTime() + (priority === 'P1' ? 2 * 3600_000 : 0) : b.start.getTime() - nextTravel * 60_000;
        if (end.getTime() <= limit) {
          found = { start, end, travel, from: prevLabel, bookedHours };
          break;
        }
        if (b.end > prevEnd) {
          prevEnd = b.end;
          if (b.loc) {
            prevLoc = b.loc;
            prevLabel = b.label;
          }
        }
      }
    }
    if (!found) continue;

    const siteVisits = q.get<{ n: number }>(
      `SELECT COUNT(*) n FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.engineer_id = ? AND j.site_id = ? AND v.status = 'completed' AND v.starts_at >= ?`,
      eng.id,
      site.id,
      addDays(now, -365).toISOString(),
    )!.n;
    const hoursUntil = (found.start.getTime() - now.getTime()) / 3600_000;
    const meetsSla = respondBy ? found.start <= respondBy : null;

    const urgency = priority === 'P1' ? 6 : priority === 'P2' ? 3 : 1;
    let score = 100;
    score -= Math.min(hoursUntil, 24 * input.days) * urgency * 0.5;
    score -= (found.travel ?? 30) * 0.4;
    score += Math.min(siteVisits, 5) * 4;
    score -= found.bookedHours * 1.5;
    score -= missing.length * 15;
    if (meetsSla === false) score -= 40;
    if (eng.kind === 'subcontractor') score -= 10;
    if (eng.grade === 'senior' || eng.grade === 'lead') score += priority === 'P1' ? 5 : 0;

    reasons.push(`Available ${fmtDateTime(found.start)}`);
    if (found.travel != null) reasons.push(`~${found.travel} min travel from ${found.from === 'home' ? 'home' : found.from}`);
    if (siteVisits) reasons.push(`Knows the site (${siteVisits} visit${siteVisits > 1 ? 's' : ''} in last 12 months)`);
    if (!missing.length && skills.length) reasons.push('Has all required skills');
    if (meetsSla === true) reasons.push('Meets SLA response target');
    if (meetsSla === false) warnings.push('Would miss SLA response target');
    if (eng.kind === 'subcontractor') warnings.push(`Subcontractor (${eng.company ?? 'external'})`);

    out.push({
      engineer_id: eng.id,
      engineer_name: eng.name,
      grade: eng.grade,
      kind: eng.kind,
      score: Math.round(score),
      slot_start: found.start.toISOString(),
      slot_end: found.end.toISOString(),
      travel_minutes: found.travel,
      travel_from: found.from,
      meets_sla: meetsSla,
      skills_match: missing.length ? 'partial' : 'full',
      site_visits_12m: siteVisits,
      booked_hours_that_day: Math.round(found.bookedHours * 10) / 10,
      reasons,
      warnings,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return {
    job: job ? { id: job.id, job_no: job.job_no, priority, respond_by: job.respond_by, est_hours: estHours, required_skills: skills, sla: slaState(job as any) } : null,
    site: { id: site.id, name: site.name, postcode: site.postcode, dbs_required: !!site.dbs_required },
    suggestions: out.slice(0, input.limit),
  };
}
