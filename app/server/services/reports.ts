import { q, parseJson, type Row } from '../db/index.ts';
import type { Actor } from '../lib/context.ts';
import { fgasStatus, qualificationState } from '../lib/compliance.ts';
import { addDays, at, today, ymd } from '../lib/time.ts';
import { listJobs } from './jobs.ts';
import { quotePipeline } from './quotes.ts';
import { lowStock } from './stock.ts';

export function dashboard(actor: Actor) {
  const t = today();
  const dayStart = at(t, '00:00').toISOString();
  const dayEnd = at(t, '23:59').toISOString();
  const open = listJobs({ status: 'open', limit: 500 });
  const slaRisk = open.filter((j) => ['at_risk', 'breached'].includes(j.sla.response) || ['at_risk', 'breached'].includes(j.sla.fix));
  const unscheduled = open.filter((j) => ['new'].includes(j.status) && !j.next_visit_at);
  const todayVisits = q.all<Row>(
    `SELECT v.id, v.status, v.starts_at, v.ends_at, v.job_id, e.name AS engineer_name, j.job_no, j.title, j.priority, j.kind, s.name AS site_name, s.postcode
     FROM visits v JOIN engineers e ON e.id = v.engineer_id JOIN jobs j ON j.id = v.job_id JOIN sites s ON s.id = j.site_id
     WHERE v.starts_at >= ? AND v.starts_at <= ? AND v.status != 'cancelled' ORDER BY v.starts_at`,
    dayStart,
    dayEnd,
  );
  const engineersOut = q.all<Row>(
    `SELECT e.id, e.name, a.kind FROM absences a JOIN engineers e ON e.id = a.engineer_id WHERE a.starts_at <= ? AND a.ends_at >= ?`,
    dayEnd,
    dayStart,
  );
  const newEnquiries = q.get<{ n: number }>(`SELECT COUNT(*) n FROM enquiries WHERE status = 'new'`)!.n;
  const onHold = open.filter((j) => j.status === 'on_hold');

  return {
    counts: {
      open_jobs: open.length,
      reactive_open: open.filter((j) => j.kind === 'reactive').length,
      p1_open: open.filter((j) => j.priority === 'P1').length,
      sla_at_risk: slaRisk.filter((j) => j.sla.response === 'at_risk' || j.sla.fix === 'at_risk').length,
      sla_breached: slaRisk.filter((j) => j.sla.response === 'breached' || j.sla.fix === 'breached').length,
      unscheduled: unscheduled.length,
      on_hold: onHold.length,
      awaiting_parts: onHold.filter((j) => j.hold_reason === 'awaiting_parts').length,
      visits_today: todayVisits.length,
      visits_completed_today: todayVisits.filter((v) => v.status === 'completed' || v.status === 'incomplete').length,
      new_enquiries: newEnquiries,
      ready_to_invoice: q.get<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE invoice_status = 'ready'`)!.n,
      completed_to_review: q.get<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE status = 'completed'`)!.n,
      ppm_overdue: q.get<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE kind = 'ppm' AND status IN ('new','scheduled','on_hold') AND due_on < ?`, t)!.n,
    },
    sla_risk: slaRisk.slice(0, 12),
    unscheduled: unscheduled.slice(0, 12),
    on_hold: onHold.slice(0, 12),
    today_visits: todayVisits,
    engineers_out: engineersOut,
    quotes: quotePipeline(),
    low_stock_count: lowStock().length,
    tasks: q.all(`SELECT a.*, c.name AS customer_name FROM activities a LEFT JOIN customers c ON c.id = a.customer_id WHERE a.kind = 'task' AND a.done = 0 AND a.user_id = ? ORDER BY a.due_on LIMIT 10`, actor.userId),
    quote_follow_ups: q.all(
      `SELECT qt.id, qt.quote_no, qt.title, qt.follow_up_on, c.name AS customer_name, COALESCE((SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = qt.id),0) AS total
       FROM quotes qt JOIN customers c ON c.id = qt.customer_id WHERE qt.status = 'sent' AND qt.follow_up_on <= ? ORDER BY qt.follow_up_on LIMIT 10`,
      ymd(addDays(new Date(), 2)),
    ),
    contract_renewals: q.all(
      `SELECT ct.id, ct.ref, ct.name, ct.ends_on, ct.annual_value, c.name AS customer_name FROM contracts ct JOIN customers c ON c.id = ct.customer_id WHERE ct.status = 'active' AND ct.ends_on <= ? ORDER BY ct.ends_on`,
      ymd(addDays(new Date(), 90)),
    ),
  };
}

export function kpis(days = 90) {
  const since = addDays(new Date(), -days).toISOString();
  const reactive = q.all<Row>(`SELECT * FROM jobs WHERE kind IN ('reactive','warranty','recall') AND created_at >= ? AND status != 'cancelled'`, since);
  const responded = reactive.filter((j) => j.attended_at && j.respond_by);
  const respondedInSla = responded.filter((j) => j.attended_at <= j.respond_by);
  const fixed = reactive.filter((j) => j.completed_at && j.fix_by);
  const fixedInSla = fixed.filter((j) => j.completed_at <= j.fix_by);
  const completedReactive = q.all<Row>(
    `SELECT j.id, (SELECT COUNT(*) FROM visits v WHERE v.job_id = j.id AND v.status IN ('completed','incomplete')) AS visit_count
     FROM jobs j WHERE j.kind = 'reactive' AND j.status IN ('completed','closed') AND j.completed_at >= ?`,
    since,
  );
  const ftf = completedReactive.filter((j) => j.visit_count === 1).length;
  const recalls = q.get<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE kind = 'recall' AND created_at >= ?`, since)!.n;
  const ppm = q.get<Row>(
    `SELECT COUNT(*) AS due, SUM(CASE WHEN status IN ('completed','closed') AND completed_at <= due_on || 'T23:59:59' THEN 1 ELSE 0 END) AS on_time,
       SUM(CASE WHEN status IN ('completed','closed') THEN 1 ELSE 0 END) AS done
     FROM jobs WHERE kind = 'ppm' AND due_on >= ? AND due_on <= ? AND status != 'cancelled'`,
    since.slice(0, 10),
    today(),
  )!;
  const quotes = q.get<Row>(
    `SELECT SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) AS lost,
       COALESCE(SUM(CASE WHEN status = 'accepted' THEN (SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = quotes.id) END),0) AS won_value
     FROM quotes WHERE decided_at >= ?`,
    since,
  )!;
  const engineerUtil = q.all<Row>(
    `SELECT e.id, e.name, COUNT(v.id) AS visits,
       ROUND(SUM((julianday(COALESCE(v.departed_at, v.ends_at)) - julianday(COALESCE(v.arrived_at, v.starts_at))) * 24), 1) AS hours_on_site,
       SUM(CASE WHEN v.outcome IN ('fixed','ppm_complete','no_fault_found') THEN 1 ELSE 0 END) AS completed_outcomes
     FROM engineers e LEFT JOIN visits v ON v.engineer_id = e.id AND v.status IN ('completed','incomplete') AND v.starts_at >= ?
     WHERE e.active = 1 GROUP BY e.id ORDER BY hours_on_site DESC`,
    since,
  );
  const byWeek = q.all(
    `SELECT strftime('%Y-%W', created_at) AS week, MIN(date(created_at)) AS week_start, COUNT(*) AS jobs,
       SUM(CASE WHEN kind = 'reactive' THEN 1 ELSE 0 END) AS reactive, SUM(CASE WHEN kind = 'ppm' THEN 1 ELSE 0 END) AS ppm
     FROM jobs WHERE created_at >= ? GROUP BY week ORDER BY week`,
    since,
  );
  const topFaultSites = q.all(
    `SELECT s.id, s.name, c.name AS customer_name, COUNT(*) AS reactive_jobs FROM jobs j JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = s.customer_id
     WHERE j.kind = 'reactive' AND j.created_at >= ? GROUP BY s.id ORDER BY reactive_jobs DESC LIMIT 8`,
    since,
  );
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    period_days: days,
    reactive_jobs: reactive.length,
    response_sla_pct: pct(respondedInSla.length, responded.length),
    fix_sla_pct: pct(fixedInSla.length, fixed.length),
    first_time_fix_pct: pct(ftf, completedReactive.length),
    recalls,
    ppm_due: ppm.due ?? 0,
    ppm_completed: ppm.done ?? 0,
    ppm_on_time_pct: pct(ppm.on_time ?? 0, ppm.due ?? 0),
    quotes_won: quotes.won ?? 0,
    quotes_lost: quotes.lost ?? 0,
    quote_win_pct: pct(quotes.won ?? 0, (quotes.won ?? 0) + (quotes.lost ?? 0)),
    quotes_won_value: quotes.won_value ?? 0,
    engineers: engineerUtil,
    jobs_by_week: byWeek,
    top_fault_sites: topFaultSites,
  };
}

export function compliance() {
  const assets = q
    .all<Row>(`SELECT a.*, s.name AS site_name, c.name AS customer_name FROM assets a JOIN sites s ON s.id = a.site_id JOIN customers c ON c.id = s.customer_id WHERE a.refrigerant IS NOT NULL AND a.status != 'decommissioned'`)
    .map((a) => ({ ...a, fgas: fgasStatus(a) }))
    .filter((a) => ['overdue', 'due_soon', 'never_checked'].includes(a.fgas.state) || a.refrigerant?.toUpperCase() === 'R22');
  const quals = q
    .all<Row>(`SELECT eq.*, e.name AS engineer_name FROM engineer_qualifications eq JOIN engineers e ON e.id = eq.engineer_id WHERE e.active = 1`)
    .map((x) => ({ ...x, state: qualificationState(x.expires_on) }))
    .filter((x) => x.state === 'expired' || x.state === 'expiring')
    .sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
  const warranties = q.all(
    `SELECT a.id, a.tag, a.category, a.manufacturer, a.model, a.warranty_expires, s.name AS site_name, c.name AS customer_name FROM assets a JOIN sites s ON s.id = a.site_id JOIN customers c ON c.id = s.customer_id
     WHERE a.warranty_expires BETWEEN ? AND ? ORDER BY a.warranty_expires`,
    today(),
    ymd(addDays(new Date(), 90)),
  );
  const unsafe = q.all(
    `SELECT d.*, s.name AS site_name, a.tag AS asset_tag, j.job_no FROM defects d JOIN sites s ON s.id = d.site_id LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN jobs j ON j.id = d.job_id
     WHERE d.severity IN ('unsafe','urgent') AND d.status IN ('open','quoted') ORDER BY d.severity DESC, d.created_at`,
  );
  return { fgas: assets.sort((a, b) => String(a.fgas.next_due_on ?? '').localeCompare(String(b.fgas.next_due_on ?? ''))), qualifications: quals, warranties, open_safety_defects: unsafe };
}

export function invoicingQueue() {
  const jobs = q.all<Row>(
    `SELECT j.id FROM jobs j WHERE j.invoice_status = 'ready' OR (j.status = 'completed' AND j.charge_type IN ('chargeable','quoted')) ORDER BY j.completed_at`,
  );
  return jobs;
}

export { parseJson };
