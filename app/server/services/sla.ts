import { q, getSetting } from '../db/index.ts';
import { DEFAULT_SLA, type Priority } from '../lib/domain.ts';
import { addSlaHours, BUSINESS_DAY, isWorkingDay, ymd } from '../lib/time.ts';

export interface SlaTerm {
  priority: Priority;
  response_hours: number;
  fix_hours: number | null;
  basis: 'business' | '24x7';
  source: 'contract' | 'standard';
}

/** The active contract covering a site on a given date (most comprehensive wins). */
export function contractForSite(siteId: number, on = ymd(new Date())) {
  return q.get(
    `SELECT c.* FROM contracts c JOIN contract_sites cs ON cs.contract_id = c.id
     WHERE cs.site_id = ? AND c.status = 'active' AND c.starts_on <= ? AND c.ends_on >= ?
     ORDER BY CASE c.level WHEN 'comprehensive' THEN 0 WHEN 'ppm_reactive' THEN 1 ELSE 2 END LIMIT 1`,
    siteId,
    on,
    on,
  );
}

export function slaTerms(contractId: number | null | undefined, priority: Priority): SlaTerm {
  if (contractId) {
    const contract = q.get<{ level: string }>('SELECT level FROM contracts WHERE id = ?', contractId);
    // PPM-only contracts do not carry reactive response commitments.
    if (contract && contract.level !== 'ppm_only') {
      const row = q.get<any>('SELECT * FROM contract_sla WHERE contract_id = ? AND priority = ?', contractId, priority);
      if (row) return { priority, response_hours: row.response_hours, fix_hours: row.fix_hours, basis: row.basis, source: 'contract' };
    }
  }
  const std = getSetting<typeof DEFAULT_SLA>('default_sla', DEFAULT_SLA)[priority];
  return { priority, response_hours: std.response_hours, fix_hours: std.fix_hours, basis: std.basis as 'business', source: 'standard' };
}

export function slaTargets(contractId: number | null | undefined, priority: Priority, loggedAt: Date) {
  const t = slaTerms(contractId, priority);
  return {
    terms: t,
    respond_by: addSlaHours(loggedAt, t.response_hours, t.basis).toISOString(),
    fix_by: t.fix_hours ? addSlaHours(loggedAt, t.fix_hours, t.basis).toISOString() : null,
  };
}

export type SlaState = 'met' | 'breached' | 'at_risk' | 'on_track' | 'none';

function clockState(target: string | null, doneAt: string | null, startedAt: string, now: Date): SlaState {
  if (!target) return 'none';
  const t = new Date(target).getTime();
  if (doneAt) return new Date(doneAt).getTime() <= t ? 'met' : 'breached';
  const n = now.getTime();
  if (n > t) return 'breached';
  const total = t - new Date(startedAt).getTime();
  const left = t - n;
  // at risk when under 25% of the window or under 2 hours remain
  if (left < Math.max(total * 0.25, 0) || left < 2 * 3600_000) return 'at_risk';
  return 'on_track';
}

export function slaState(job: { respond_by: string | null; fix_by: string | null; attended_at: string | null; completed_at: string | null; created_at: string; status: string; kind: string }, now = new Date()) {
  if (job.status === 'cancelled' || !['reactive', 'warranty', 'recall'].includes(job.kind)) {
    return { response: 'none' as SlaState, fix: 'none' as SlaState };
  }
  return {
    response: clockState(job.respond_by, job.attended_at, job.created_at, now),
    fix: clockState(job.fix_by, job.completed_at, job.created_at, now),
  };
}

export function isOutOfHours(d: Date) {
  const h = d.getHours() + d.getMinutes() / 60;
  return !isWorkingDay(d) || h < BUSINESS_DAY.start || h >= BUSINESS_DAY.end;
}
