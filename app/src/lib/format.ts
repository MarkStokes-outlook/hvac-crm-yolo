const tz = 'Europe/London';

export const money = (n: number | null | undefined, dp = 0) =>
  n == null ? '—' : n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: dp, maximumFractionDigits: dp });

export const money2 = (n: number | null | undefined) => money(n, 2);

export const date = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }) : '—');

export const shortDate = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }) : '—');

export const time = (s: string | null | undefined) => (s ? new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '—');

export const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }) : '—';

export function relative(s: string | null | undefined) {
  if (!s) return '—';
  const diff = new Date(s).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const text = mins < 60 ? `${mins}m` : mins < 60 * 36 ? `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim() : `${Math.round(mins / 1440)}d`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

export const titleCase = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

/** datetime-local input value from ISO */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const fromLocalInput = (v: string) => new Date(v).toISOString();
