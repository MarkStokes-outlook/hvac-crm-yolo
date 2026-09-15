import { GWP } from './domain.ts';
import { addMonths, today } from './time.ts';

const GWP_CI: Record<string, number> = Object.fromEntries(Object.entries(GWP).map(([k, v]) => [k.toUpperCase(), v]));

export interface FgasStatus {
  gwp: number | null;
  co2e_tonnes: number | null;
  /** months between mandatory leak checks, null when no check is required */
  interval_months: number | null;
  next_due_on: string | null;
  state: 'not_required' | 'ok' | 'due_soon' | 'overdue' | 'never_checked' | 'unknown';
  leak_detection_required: boolean;
  note?: string;
}

/**
 * UK F-Gas leak checking requirements for stationary equipment, based on CO2-equivalent charge.
 *   5t–<50t   : every 12 months (24 with automatic leak detection)
 *   50t–<500t : every 6 months (12 with leak detection)
 *   ≥500t     : every 3 months (6 with leak detection) — leak detection mandatory
 */
export function fgasStatus(asset: {
  refrigerant?: string | null;
  refrigerant_kg?: number | null;
  leak_detection?: number | boolean | null;
  last_leak_check_on?: string | null;
}): FgasStatus {
  if (!asset.refrigerant || !asset.refrigerant_kg) {
    return { gwp: null, co2e_tonnes: null, interval_months: null, next_due_on: null, state: 'not_required', leak_detection_required: false };
  }
  const gwp = GWP_CI[asset.refrigerant.trim().toUpperCase()];
  if (!gwp) {
    return { gwp: null, co2e_tonnes: null, interval_months: null, next_due_on: null, state: 'unknown', leak_detection_required: false, note: `Unknown refrigerant ${asset.refrigerant}` };
  }
  const co2e = Math.round(((asset.refrigerant_kg * gwp) / 1000) * 100) / 100;
  const detection = Boolean(asset.leak_detection);
  let interval: number | null = null;
  if (co2e >= 500) interval = detection ? 6 : 3;
  else if (co2e >= 50) interval = detection ? 12 : 6;
  else if (co2e >= 5) interval = detection ? 24 : 12;

  const note = asset.refrigerant.toUpperCase() === 'R22' ? 'R22 (HCFC) — cannot be topped up; plan replacement' : undefined;
  if (interval === null) {
    return { gwp, co2e_tonnes: co2e, interval_months: null, next_due_on: null, state: 'not_required', leak_detection_required: false, note };
  }
  if (!asset.last_leak_check_on) {
    return { gwp, co2e_tonnes: co2e, interval_months: interval, next_due_on: null, state: 'never_checked', leak_detection_required: co2e >= 500, note };
  }
  const next = addMonths(asset.last_leak_check_on, interval);
  const t = today();
  const soon = addMonths(t, 1);
  const state = next < t ? 'overdue' : next <= soon ? 'due_soon' : 'ok';
  return { gwp, co2e_tonnes: co2e, interval_months: interval, next_due_on: next, state, leak_detection_required: co2e >= 500, note };
}

export function qualificationState(expires_on: string | null | undefined): 'valid' | 'expiring' | 'expired' | 'no_expiry' {
  if (!expires_on) return 'no_expiry';
  const t = today();
  if (expires_on < t) return 'expired';
  if (expires_on <= addMonths(t, 2)) return 'expiring';
  return 'valid';
}
