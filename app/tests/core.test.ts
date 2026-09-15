import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { q, type Row } from '../server/db/index.ts';
import { seed } from '../server/seed/seed.ts';
import { addSlaHours, at } from '../server/lib/time.ts';
import { fgasStatus } from '../server/lib/compliance.ts';
import type { Actor } from '../server/lib/context.ts';
import * as jobs from '../server/services/jobs.ts';
import * as sched from '../server/services/scheduling.ts';
import * as quotes from '../server/services/quotes.ts';
import * as stock from '../server/services/stock.ts';
import * as contracts from '../server/services/contracts.ts';
import { runTool } from '../server/ai/tools.ts';
import { ruleTriage, triage } from '../server/ai/features.ts';
import { createApp } from '../server/app.ts';

let coordinator: Actor;
const site = (name: string) => q.get<Row>('SELECT * FROM sites WHERE name = ?', name)!;
const asset = (siteName: string, tag: string) => q.get<Row>('SELECT a.* FROM assets a JOIN sites s ON s.id = a.site_id WHERE s.name = ? AND a.tag = ?', siteName, tag)!;
const engineerActor = (name: string): Actor => {
  const e = q.get<Row>('SELECT e.id, u.id AS uid FROM engineers e JOIN users u ON u.id = e.user_id WHERE e.name = ?', name)!;
  return { userId: e.uid, name, role: 'engineer', engineerId: e.id };
};

beforeAll(() => {
  seed();
  const u = q.get<Row>(`SELECT * FROM users WHERE email = 'rachel.dunn@frostline.co.uk'`)!;
  coordinator = { userId: u.id, name: u.name, role: 'coordinator', engineerId: null };
});

describe('business time & compliance', () => {
  it('counts SLA business hours only inside the working day', () => {
    // Friday 16:30 + 2 business hours → Monday 09:00 (08:00–17:30 day)
    const fri = at('2026-09-18', '16:30');
    expect(addSlaHours(fri, 2, 'business').toString()).toBe(at('2026-09-21', '09:00').toString());
    // 24x7 is wall clock
    expect(addSlaHours(fri, 4, '24x7').getTime()).toBe(fri.getTime() + 4 * 3600_000);
  });

  it('works out F-Gas leak check intervals from CO2e', () => {
    const s = fgasStatus({ refrigerant: 'R410A', refrigerant_kg: 28, leak_detection: 1, last_leak_check_on: '2026-01-01' });
    expect(s.co2e_tonnes).toBeCloseTo(58.46, 1);
    expect(s.interval_months).toBe(12); // 50–500t with leak detection
    expect(fgasStatus({ refrigerant: 'R32', refrigerant_kg: 0.9 }).state).toBe('not_required'); // < 5t
  });
});

describe('jobs', () => {
  it('applies contract SLA and charge type when logging a job', () => {
    const s = site('Oakfield Lodge Care Home');
    const { job, warnings } = jobs.createJob(coordinator, { site_id: s.id, priority: 'P1', title: 'No heating east wing', asset_ids: [asset('Oakfield Lodge Care Home', 'BLR-01').id] });
    expect(job.contract_ref).toBeTruthy();
    expect(job.charge_type).toBe('contract');
    expect(job.sla_terms.source).toBe('contract');
    expect(job.sla_terms.response_hours).toBe(4);
    expect(new Date(job.respond_by).getTime() - new Date(job.created_at).getTime()).toBeLessThanOrEqual(4 * 3600_000 + 5000);
    expect(job.required_skills).toContain('gas');
    expect(warnings.join(' ')).toMatch(/DBS/);
  });

  it('blocks chargeable work for an on-stop customer unless overridden', () => {
    const s = site('Vantage Gym Stockport');
    expect(() => jobs.createJob(coordinator, { site_id: s.id, priority: 'P3', title: 'Gym AC not cooling' })).toThrow(/ON STOP/);
    const { job } = jobs.createJob(coordinator, { site_id: s.id, priority: 'P3', title: 'Gym AC not cooling', override_on_stop: true });
    expect(job.charge_type).toBe('chargeable');
  });

  it('treats reactive work on a PPM-only contract as chargeable with standard SLA', () => {
    const s = site('Hollins Park Primary School');
    const { job, warnings } = jobs.createJob(coordinator, { site_id: s.id, priority: 'P2', title: 'ICT suite AC leaking' });
    expect(job.charge_type).toBe('chargeable');
    expect(job.sla_terms.source).toBe('standard');
    expect(warnings.join(' ')).toMatch(/PPM-only/);
  });
});

describe('scheduling & engineer workflow', () => {
  it('recommends only suitably qualified engineers and books a visit', () => {
    const s = site('Northern Fresh — Bury Market Street');
    const { job } = jobs.createJob(coordinator, { site_id: s.id, priority: 'P2', title: 'Cold room warm', asset_ids: [asset('Northern Fresh — Bury Market Street', 'CR-01').id] });
    const res = sched.suggestEngineers({ job_id: job.id, days: 10 });
    expect(res.suggestions.length).toBeGreaterThan(0);
    for (const sug of res.suggestions) {
      const quals = q.all<Row>('SELECT code, expires_on FROM engineer_qualifications WHERE engineer_id = ?', sug.engineer_id);
      expect(quals.some((x) => x.code === 'FGAS_CAT1' && (!x.expires_on || x.expires_on >= new Date().toISOString().slice(0, 10)))).toBe(true);
      expect(sug.grade).not.toBe('apprentice');
    }
    const best = res.suggestions[0];
    const { visit } = sched.scheduleVisit(coordinator, { job_id: job.id, engineer_id: best.engineer_id, starts_at: best.slot_start });
    expect(visit.status).toBe('scheduled');
    // Same slot again should clash
    expect(() => sched.scheduleVisit(coordinator, { job_id: job.id, engineer_id: best.engineer_id, starts_at: best.slot_start })).toThrow(/already booked/);

    // Engineer runs the visit: parts required → job on hold awaiting parts
    const eng = engineerActor(best.engineer_name);
    sched.visitAction(eng, visit.id, 'travel');
    sched.visitAction(eng, visit.id, 'arrive');
    const after = sched.completeVisit(eng, visit.id, { outcome: 'parts_required', work_summary: 'Evaporator fan motor seized, need replacement' });
    expect(after.status).toBe('on_hold');
    expect(after.hold_reason).toBe('awaiting_parts');
    expect(after.attended_at).toBeTruthy();

    // PO for the job; receiving it releases the job back to the scheduling queue
    const part = q.get<Row>(`SELECT id FROM parts WHERE sku = 'FAN-EVAP-10W'`)!;
    const supplier = q.get<Row>('SELECT id FROM suppliers LIMIT 1')!;
    const po = stock.createPurchaseOrder(coordinator, { supplier_id: supplier.id, job_id: job.id, lines: [{ part_id: part.id, qty: 1 }], place_order: true });
    const before = q.get<Row>('SELECT qty FROM stock_levels WHERE part_id = ? AND location_id = ?', part.id, po.location_id)!.qty;
    stock.receivePurchaseOrder(coordinator, po.id, [{ line_id: po.lines[0].id, qty: 1 }]);
    expect(q.get<Row>('SELECT qty FROM stock_levels WHERE part_id = ? AND location_id = ?', part.id, po.location_id)!.qty).toBe(before + 1);
    expect(jobs.getJob(job.id).status).toBe('new');
  });

  it('stops engineers touching visits that are not theirs', () => {
    const v = q.get<Row>(`SELECT v.id, e.name FROM visits v JOIN engineers e ON e.id = v.engineer_id WHERE v.status = 'scheduled' AND e.user_id IS NOT NULL LIMIT 1`)!;
    const other = q.get<Row>(`SELECT name FROM engineers WHERE name != ? AND user_id IS NOT NULL LIMIT 1`, v.name)!;
    expect(() => sched.visitAction(engineerActor(other.name), v.id, 'arrive')).toThrow(/not assigned/);
  });

  it('deducts van stock when an engineer books parts to a job', () => {
    const eng = engineerActor('Dave Whittaker');
    const van = q.get<Row>('SELECT id FROM stock_locations WHERE engineer_id = ?', eng.engineerId)!;
    const lvl = q.get<Row>('SELECT * FROM stock_levels WHERE location_id = ? AND qty > 0 LIMIT 1', van.id)!;
    const job = q.get<Row>(`SELECT id FROM jobs WHERE status = 'in_progress' LIMIT 1`)!;
    jobs.addPart(eng, job.id, { part_id: lvl.part_id, qty: 1, location_id: van.id });
    expect(q.get<Row>('SELECT qty FROM stock_levels WHERE part_id = ? AND location_id = ?', lvl.part_id, van.id)!.qty).toBe(lvl.qty - 1);
  });
});

describe('quotes & PPM', () => {
  it('takes a quote from draft to an accepted job', () => {
    const s = site('Harlow House');
    const qt = quotes.createQuote(coordinator, { site_id: s.id, kind: 'replacement', title: 'Replace R22 server room split', lines: [{ kind: 'labour', description: 'Engineers', qty: 8, unit_cost: 28 }, { kind: 'equipment', description: '5kW R32 split', qty: 1, unit_cost: 900 }] });
    expect(qt.totals.net).toBeGreaterThan(qt.totals.cost);
    expect(() => quotes.convertQuoteToJob(coordinator, qt.id)).toThrow(/accepted/);
    quotes.setQuoteStatus(coordinator, qt.id, 'sent');
    quotes.setQuoteStatus(coordinator, qt.id, 'accepted', { customer_po: 'WO-1' });
    const { job } = quotes.convertQuoteToJob(coordinator, qt.id);
    expect(job.kind).toBe('installation');
    expect(job.charge_type).toBe('quoted');
    expect(job.customer_ref).toBe('WO-1');
  });

  it('generates PPM jobs once per due date', () => {
    const until = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const first = contracts.generatePpmJobs(coordinator, until);
    expect(first.created.length).toBeGreaterThan(0);
    const second = contracts.generatePpmJobs(coordinator, until);
    expect(second.created.length).toBe(0);
  });
});

describe('AI tool layer (no model needed)', () => {
  it('validates tool input and enforces role permissions', () => {
    const links: any[] = [];
    expect(runTool(coordinator, 'get_job', { job_id: 'nope' }, links)).toMatchObject({ error: 'Invalid input' });
    const eng = engineerActor('Lee Ashworth');
    expect(() => runTool(eng, 'create_job', { site_id: 1, priority: 'P3', title: 'x' }, links)).toThrow(/cannot use/);
    const res = runTool(coordinator, 'search', { term: 'Harlow' }, links) as Row;
    expect(res.sites[0].name).toBe('Harlow House');
  });

  it('creates a job through the tool and records it as AI-made', () => {
    const links: any[] = [];
    const s = site('Quay View Offices');
    const res = runTool(coordinator, 'create_job', { site_id: s.id, priority: 'P3', title: 'Reception too warm' }, links) as Row;
    expect(res.job.job_no).toMatch(/^J-/);
    expect(links[0]).toMatchObject({ type: 'job', action: 'created' });
    expect(q.get<Row>(`SELECT via_ai FROM audit_log WHERE entity_type = 'job' AND entity_id = ? AND action = 'created'`, res.job.id)!.via_ai).toBe(1);
  });

  it('falls back to rule-based triage and matches the sender to a site', async () => {
    expect(ruleTriage('Cold room alarm, stock at risk').priority).toBe('P1');
    const e = q.get<Row>(`SELECT * FROM enquiries WHERE from_email = 'angela.firth@brightwatercare.example'`)!;
    const t = await triage({ text: e.body, from_email: e.from_email, customer_id: e.customer_id, site_id: e.site_id });
    expect(t.source).toBe('rules');
    expect(t.priority).toBe('P1');
    expect(t.site_candidates[0].name).toBe('Oakfield Lodge Care Home');
  });
});

describe('HTTP API', () => {
  it('requires sign in and serves the dashboard', async () => {
    const app = createApp();
    await request(app).get('/api/dashboard').expect(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'rachel.dunn@frostline.co.uk', password: 'frostline' }).expect(200);
    const cookie = login.headers['set-cookie'];
    const dash = await request(app).get('/api/dashboard').set('Cookie', cookie).expect(200);
    expect(dash.body.counts.open_jobs).toBeGreaterThan(0);
    await request(app).post('/api/ai/chat').set('Cookie', cookie).send({ message: 'hi' }).expect(200).expect(/not configured/);
  });
});
