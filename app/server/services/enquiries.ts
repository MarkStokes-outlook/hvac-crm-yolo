import { z } from 'zod';
import { q, insert, update, parseJson, type Row } from '../db/index.ts';
import { audit, notFound, type Actor } from '../lib/context.ts';
import { nowIso } from '../lib/time.ts';

export function listEnquiries(status = 'open') {
  const where = status === 'open' ? `e.status IN ('new','in_progress')` : status === 'all' ? '1=1' : 'e.status = ?';
  return q
    .all<Row>(
      `SELECT e.*, c.name AS customer_name, s.name AS site_name, j.job_no, qt.quote_no, u.name AS handled_by_name FROM enquiries e
       LEFT JOIN customers c ON c.id = e.customer_id LEFT JOIN sites s ON s.id = e.site_id LEFT JOIN jobs j ON j.id = e.job_id LEFT JOIN quotes qt ON qt.id = e.quote_id LEFT JOIN users u ON u.id = e.handled_by
       WHERE ${where} ORDER BY e.received_at DESC LIMIT 200`,
      ...(status === 'open' || status === 'all' ? [] : [status]),
    )
    .map((e) => ({ ...e, triage: parseJson(e.triage, null) }));
}

export function getEnquiry(id: number) {
  const e = listEnquiries('all').find((x) => x.id === id);
  if (!e) throw notFound('Enquiry');
  return { ...e, matches: matchSender(e) };
}

/** Match an enquiry's sender to known contacts / customers by email, phone or email domain. */
export function matchSender(e: { from_email?: string | null; from_phone?: string | null; from_name?: string | null }) {
  const out: Row[] = [];
  if (e.from_email) {
    out.push(
      ...q.all(
        `SELECT ct.id AS contact_id, ct.name AS contact_name, ct.site_id, c.id AS customer_id, c.name AS customer_name, s.name AS site_name, 'email' AS matched_on
         FROM contacts ct JOIN customers c ON c.id = ct.customer_id LEFT JOIN sites s ON s.id = ct.site_id WHERE lower(ct.email) = lower(?)`,
        e.from_email,
      ),
    );
    const domain = e.from_email.split('@')[1]?.toLowerCase();
    if (!out.length && domain && !['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.co.uk', 'icloud.com', 'btinternet.com'].includes(domain)) {
      out.push(
        ...q.all(
          `SELECT DISTINCT NULL AS contact_id, NULL AS contact_name, NULL AS site_id, c.id AS customer_id, c.name AS customer_name, NULL AS site_name, 'domain' AS matched_on
           FROM contacts ct JOIN customers c ON c.id = ct.customer_id WHERE lower(ct.email) LIKE ? LIMIT 3`,
          `%@${domain}`,
        ),
      );
    }
  }
  if (e.from_phone && !out.length) {
    const digits = e.from_phone.replace(/\D/g, '').slice(-9);
    if (digits.length >= 9) {
      out.push(
        ...q.all(
          `SELECT ct.id AS contact_id, ct.name AS contact_name, ct.site_id, c.id AS customer_id, c.name AS customer_name, s.name AS site_name, 'phone' AS matched_on
           FROM contacts ct JOIN customers c ON c.id = ct.customer_id LEFT JOIN sites s ON s.id = ct.site_id
           WHERE replace(replace(COALESCE(ct.phone,''),' ',''),'-','') LIKE ? OR replace(replace(COALESCE(ct.mobile,''),' ',''),'-','') LIKE ?`,
          `%${digits}`,
          `%${digits}`,
        ),
      );
    }
  }
  return out;
}

export const EnquiryInput = z.object({
  channel: z.enum(['email', 'phone', 'web', 'voicemail']),
  from_name: z.string().optional().nullable(),
  from_email: z.string().optional().nullable(),
  from_phone: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  body: z.string().min(1),
});

export function createEnquiry(actor: Actor | null, raw: z.input<typeof EnquiryInput>) {
  const input = EnquiryInput.parse(raw);
  const match = matchSender(input)[0];
  const id = insert('enquiries', { ...input, received_at: nowIso(), status: 'new', customer_id: match?.customer_id ?? null, site_id: match?.site_id ?? null });
  if (actor) audit(actor, 'enquiry', id, 'created');
  return getEnquiry(id);
}

export function updateEnquiry(actor: Actor, id: number, data: { status?: string; customer_id?: number | null; site_id?: number | null; job_id?: number | null; quote_id?: number | null; triage?: unknown }) {
  if (!q.get('SELECT id FROM enquiries WHERE id = ?', id)) throw notFound('Enquiry');
  const patch: Row = { ...data };
  if (data.status && ['actioned', 'dismissed'].includes(data.status)) Object.assign(patch, { handled_by: actor.userId, handled_at: nowIso() });
  update('enquiries', id, patch);
  if (data.status) audit(actor, 'enquiry', id, `status_${data.status}`);
  return getEnquiry(id);
}
