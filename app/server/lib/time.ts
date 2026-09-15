// All business-time logic runs in UK local time.
process.env.TZ = process.env.TZ || 'Europe/London';

export const BUSINESS_DAY = { start: 8, end: 17.5 }; // 08:00 – 17:30

// England & Wales bank holidays
const BANK_HOLIDAYS = new Set([
  '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
]);

export const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(dateStr: string, months: number): string {
  const d = parseYmd(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ymd(d);
}

/** Build a local datetime from a date string and "HH:MM". */
export function at(dateStr: string, hhmm: string): Date {
  const d = parseYmd(dateStr);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function isWorkingDay(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !BANK_HOLIDAYS.has(ymd(d));
}

export function hoursToHHMM(h: number) {
  return `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;
}

/**
 * Add SLA hours to a start time.
 * - '24x7' basis: wall-clock hours.
 * - 'business' basis: only counts time inside working hours on working days.
 */
export function addSlaHours(from: Date, hours: number, basis: 'business' | '24x7'): Date {
  if (basis === '24x7') return new Date(from.getTime() + hours * 3600_000);
  let remaining = hours * 60; // minutes
  let cursor = new Date(from);
  const dayStartMin = BUSINESS_DAY.start * 60;
  const dayEndMin = BUSINESS_DAY.end * 60;
  for (let guard = 0; guard < 1000 && remaining > 0; guard++) {
    if (!isWorkingDay(cursor)) {
      cursor = addDays(cursor, 1);
      cursor.setHours(BUSINESS_DAY.start, 0, 0, 0);
      continue;
    }
    const minutesNow = cursor.getHours() * 60 + cursor.getMinutes();
    if (minutesNow < dayStartMin) {
      cursor.setHours(BUSINESS_DAY.start, (BUSINESS_DAY.start % 1) * 60, 0, 0);
      continue;
    }
    if (minutesNow >= dayEndMin) {
      cursor = addDays(cursor, 1);
      cursor.setHours(BUSINESS_DAY.start, 0, 0, 0);
      continue;
    }
    const available = dayEndMin - minutesNow;
    const used = Math.min(available, remaining);
    cursor = new Date(cursor.getTime() + used * 60_000);
    remaining -= used;
    if (remaining > 0) {
      cursor = addDays(cursor, 1);
      cursor.setHours(BUSINESS_DAY.start, 0, 0, 0);
    }
  }
  return cursor;
}

export const iso = (d: Date) => d.toISOString();
export const nowIso = () => new Date().toISOString();
export const today = () => ymd(new Date());

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
