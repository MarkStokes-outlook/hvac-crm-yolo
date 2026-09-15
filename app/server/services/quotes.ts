import { z } from 'zod';
import { q, insert, update, nextNumber, getSetting, type Row } from '../db/index.ts';
import { audit, badRequest, notFound, type Actor } from '../lib/context.ts';
import { DEFAULT_RATES } from '../lib/domain.ts';
import { addDays, nowIso, today, ymd } from '../lib/time.ts';
import { createJob, updateJob } from './jobs.ts';

export const QuoteLineInput = z.object({
  kind: z.enum(['labour', 'materials', 'equipment', 'subcontract', 'access', 'other']),
  part_id: z.number().int().optional().nullable(),
  description: z.string().min(1),
  qty: z.number().positive().default(1),
  unit_cost: z.number().min(0).default(0),
  unit_price: z.number().min(0).optional(),
});

export const QuoteInput = z.object({
  customer_id: z.number().int().optional(),
  site_id: z.number().int().optional().nullable(),
  contact_id: z.number().int().optional().nullable(),
  kind: z.enum(['repair', 'remedial', 'replacement', 'installation', 'maintenance_contract', 'other']).default('repair'),
  title: z.string().min(3),
  scope: z.string().optional().nullable(),
  exclusions: z.string().optional().nullable(),
  source_job_id: z.number().int().optional().nullable(),
  defect_ids: z.array(z.number().int()).optional(),
  valid_days: z.number().int().default(30),
  follow_up_on: z.string().optional().nullable(),
  probability: z.number().int().min(0).max(100).optional().nullable(),
  lines: z.array(QuoteLineInput).default([]),
});

function priceLine(line: z.infer<typeof QuoteLineInput>) {
  if (line.unit_price != null) return line.unit_price;
  const rates = getSetting('rates', DEFAULT_RATES);
  if (line.kind === 'labour') return line.unit_cost > 0 ? Math.round(line.unit_cost * 2.2 * 100) / 100 : rates.labour_normal;
  if (line.part_id) {
    const p = q.get<Row>('SELECT sell_price FROM parts WHERE id = ?', line.part_id);
    if (p) return p.sell_price;
  }
  return Math.round(line.unit_cost * (1 + rates.materials_markup_pct / 100) * 100) / 100;
}

export const DEFAULT_EXCLUSIONS =
  'Works outside normal hours unless stated. Builders work, making good and decoration. Asbestos survey or removal. Electrical supply alterations beyond the isolator. Any access equipment not listed. Prices exclude VAT.';

export function createQuote(actor: Actor, raw: z.input<typeof QuoteInput>) {
  const input = QuoteInput.parse(raw);
  let customerId = input.customer_id;
  let siteId = input.site_id ?? null;
  if (input.source_job_id) {
    const job = q.get<Row>('SELECT customer_id, site_id FROM jobs WHERE id = ?', input.source_job_id);
    if (!job) throw notFound('Job');
    customerId ??= job.customer_id;
    siteId ??= job.site_id;
  }
  if (siteId && !customerId) customerId = q.get<Row>('SELECT customer_id FROM sites WHERE id = ?', siteId)?.customer_id;
  if (!customerId) throw badRequest('customer_id, site_id or source_job_id required');
  const quoteNo = nextNumber('quote', 'Q-', 5);
  const id = q.tx(() => {
    const qid = insert('quotes', {
      quote_no: quoteNo,
      customer_id: customerId,
      site_id: siteId,
      contact_id: input.contact_id ?? null,
      kind: input.kind,
      title: input.title,
      scope: input.scope ?? null,
      exclusions: input.exclusions ?? DEFAULT_EXCLUSIONS,
      status: 'draft',
      source_job_id: input.source_job_id ?? null,
      prepared_by: actor.userId,
      valid_until: ymd(addDays(new Date(), input.valid_days)),
      follow_up_on: input.follow_up_on ?? null,
      probability: input.probability ?? null,
    });
    input.lines.forEach((l, i) => insert('quote_lines', { quote_id: qid, sort: i, ...l, unit_price: priceLine(l) }));
    for (const d of input.defect_ids ?? []) update('defects', d, { status: 'quoted', quote_id: qid });
    audit(actor, 'quote', qid, 'created', `${quoteNo} ${input.title}`);
    return qid;
  });
  return getQuote(id);
}

export function getQuote(id: number) {
  const qt = q.get<Row>(
    `SELECT qt.*, c.name AS customer_name, c.billing_address, c.billing_postcode, s.name AS site_name, s.address AS site_address, s.town AS site_town, s.postcode AS site_postcode,
       ct.name AS contact_name, ct.email AS contact_email, u.name AS prepared_by_name, u.job_title AS prepared_by_title, j.job_no AS source_job_no, cj.job_no AS converted_job_no
     FROM quotes qt JOIN customers c ON c.id = qt.customer_id LEFT JOIN sites s ON s.id = qt.site_id LEFT JOIN contacts ct ON ct.id = qt.contact_id
     LEFT JOIN users u ON u.id = qt.prepared_by LEFT JOIN jobs j ON j.id = qt.source_job_id LEFT JOIN jobs cj ON cj.id = qt.converted_job_id WHERE qt.id = ?`,
    id,
  );
  if (!qt) throw notFound('Quote');
  qt.lines = q.all('SELECT ql.*, p.sku FROM quote_lines ql LEFT JOIN parts p ON p.id = ql.part_id WHERE quote_id = ? ORDER BY sort, id', id);
  qt.defects = q.all('SELECT d.*, a.tag AS asset_tag FROM defects d LEFT JOIN assets a ON a.id = d.asset_id WHERE d.quote_id = ?', id);
  qt.totals = quoteTotals(qt.lines);
  qt.history = q.all(`SELECT al.*, u.name AS user_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id WHERE entity_type = 'quote' AND entity_id = ? ORDER BY al.id DESC`, id);
  qt.activities = q.all('SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.quote_id = ? ORDER BY a.created_at DESC', id);
  return qt;
}

export function quoteTotals(lines: Row[]) {
  const vatPct = getSetting('rates', DEFAULT_RATES).vat_pct;
  const net = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const cost = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { net: r(net), cost: r(cost), margin: r(net - cost), margin_pct: net ? Math.round(((net - cost) / net) * 1000) / 10 : 0, vat: r((net * vatPct) / 100), gross: r(net * (1 + vatPct / 100)) };
}

export function listQuotes(opts: { status?: string; customer_id?: number; search?: string; mine?: number } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.status === 'open') where.push(`qt.status IN ('draft','sent')`);
  else if (opts.status) {
    const vals = opts.status.split(',');
    where.push(`qt.status IN (${vals.map(() => '?').join(',')})`);
    p.push(...vals);
  }
  if (opts.customer_id) (where.push('qt.customer_id = ?'), p.push(opts.customer_id));
  if (opts.mine) (where.push('qt.prepared_by = ?'), p.push(opts.mine));
  if (opts.search) {
    const s = `%${opts.search}%`;
    where.push('(qt.quote_no LIKE ? OR qt.title LIKE ? OR c.name LIKE ? OR s.name LIKE ?)');
    p.push(s, s, s, s);
  }
  return q.all(
    `SELECT qt.id, qt.quote_no, qt.title, qt.kind, qt.status, qt.valid_until, qt.sent_at, qt.decided_at, qt.follow_up_on, qt.probability, qt.created_at, qt.converted_job_id,
       c.name AS customer_name, c.id AS customer_id, s.name AS site_name, u.name AS prepared_by_name,
       COALESCE((SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = qt.id),0) AS total,
       COALESCE((SELECT SUM(qty*unit_cost) FROM quote_lines WHERE quote_id = qt.id),0) AS cost
     FROM quotes qt JOIN customers c ON c.id = qt.customer_id LEFT JOIN sites s ON s.id = qt.site_id LEFT JOIN users u ON u.id = qt.prepared_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY qt.created_at DESC LIMIT 300`,
    ...p,
  );
}

export function updateQuote(actor: Actor, id: number, raw: Partial<z.input<typeof QuoteInput>> & { lines?: z.input<typeof QuoteLineInput>[] }) {
  const qt = q.get<Row>('SELECT * FROM quotes WHERE id = ?', id);
  if (!qt) throw notFound('Quote');
  if (!['draft', 'sent'].includes(qt.status)) throw badRequest(`Quote is ${qt.status} and can no longer be edited`);
  const input = QuoteInput.partial().parse(raw);
  q.tx(() => {
    const { lines, defect_ids, valid_days, customer_id, source_job_id, ...fields } = input;
    update('quotes', id, { ...fields, valid_until: valid_days ? ymd(addDays(new Date(), valid_days)) : undefined, updated_at: nowIso() });
    if (raw.lines) {
      q.run('DELETE FROM quote_lines WHERE quote_id = ?', id);
      raw.lines.map((l) => QuoteLineInput.parse(l)).forEach((l, i) => insert('quote_lines', { quote_id: id, sort: i, ...l, unit_price: priceLine(l) }));
    }
    audit(actor, 'quote', id, 'updated');
  });
  return getQuote(id);
}

export function setQuoteStatus(actor: Actor, id: number, status: 'sent' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'draft', extra: { decline_reason?: string; customer_po?: string } = {}) {
  const qt = q.get<Row>('SELECT * FROM quotes WHERE id = ?', id);
  if (!qt) throw notFound('Quote');
  const allowed: Record<string, string[]> = {
    draft: ['sent', 'cancelled'],
    sent: ['accepted', 'declined', 'expired', 'draft', 'cancelled'],
    expired: ['sent', 'accepted', 'declined'],
    declined: ['draft'],
    accepted: [],
    cancelled: ['draft'],
  };
  if (!allowed[qt.status]?.includes(status)) throw badRequest(`Cannot change a ${qt.status} quote to ${status}`);
  const lines = q.get<{ n: number }>('SELECT COUNT(*) n FROM quote_lines WHERE quote_id = ?', id)!.n;
  if (status === 'sent' && !lines) throw badRequest('Add at least one line before sending');
  const data: Row = { status, updated_at: nowIso() };
  if (status === 'sent') {
    data.sent_at = nowIso();
    data.follow_up_on = qt.follow_up_on ?? ymd(addDays(new Date(), 7));
  }
  if (['accepted', 'declined'].includes(status)) data.decided_at = nowIso();
  if (status === 'declined') data.decline_reason = extra.decline_reason ?? null;
  if (status === 'accepted' && extra.customer_po) data.customer_po = extra.customer_po;
  q.tx(() => {
    update('quotes', id, data);
    if (status === 'accepted') q.run(`UPDATE defects SET status = 'approved' WHERE quote_id = ?`, id);
    if (status === 'declined') q.run(`UPDATE defects SET status = 'declined' WHERE quote_id = ?`, id);
    audit(actor, 'quote', id, `status_${status}`, extra.decline_reason ?? extra.customer_po);
    // release a job waiting on this quote
    if (status === 'accepted' || status === 'declined') {
      const waiting = q.all<Row>(`SELECT id FROM jobs WHERE id = ? AND status = 'on_hold' AND hold_reason = 'awaiting_quote_approval'`, qt.source_job_id ?? -1);
      // the diagnostic/reactive job is finished either way; accepted works proceed as a new job on conversion
      for (const j of waiting) updateJob(actor, j.id, { status: 'completed', reason: `Quote ${qt.quote_no} ${status}` });
    }
  });
  return getQuote(id);
}

/** Turn an accepted quote into a job (quoted works or installation), carrying scope, value and linked equipment. */
export function convertQuoteToJob(actor: Actor, id: number, opts: { target_start_on?: string; est_hours?: number; priority?: 'P2' | 'P3' | 'P4' } = {}) {
  const qt = getQuote(id);
  if (qt.status !== 'accepted') throw badRequest('Only accepted quotes can be converted to jobs');
  if (qt.converted_job_id) throw badRequest(`Already converted to ${qt.converted_job_no}`);
  if (!qt.site_id) throw badRequest('Quote needs a site before it can become a job');
  const labourHours = qt.lines.filter((l: Row) => l.kind === 'labour').reduce((s: number, l: Row) => s + l.qty, 0);
  const assetIds = [...new Set(qt.defects.map((d: Row) => d.asset_id).filter(Boolean))] as number[];
  const { job } = createJob(actor, {
    site_id: qt.site_id,
    kind: ['installation', 'replacement'].includes(qt.kind) ? 'installation' : 'quoted',
    priority: opts.priority ?? 'P3',
    title: qt.title,
    description: `${qt.scope ?? ''}\n\nFrom quote ${qt.quote_no} — £${qt.totals.net.toFixed(2)} + VAT.`.trim(),
    reported_via: 'quote',
    charge_type: 'quoted',
    customer_ref: qt.customer_po ?? null,
    quote_id: qt.id,
    parent_job_id: qt.source_job_id ?? null,
    est_hours: opts.est_hours ?? (labourHours || 4),
    target_start_on: opts.target_start_on ?? today(),
    asset_ids: assetIds,
  });
  update('quotes', id, { converted_job_id: job.id, updated_at: nowIso() });
  audit(actor, 'quote', id, 'converted', job.job_no);
  // materials to order: quote lines that reference catalogue parts
  const materials = qt.lines.filter((l: Row) => ['materials', 'equipment'].includes(l.kind));
  return { job, materials_to_order: materials };
}

export function quotePipeline() {
  return q.get(
    `SELECT
       SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count,
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
       COALESCE(SUM(CASE WHEN status = 'sent' THEN (SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = quotes.id) END),0) AS sent_value,
       COALESCE(SUM(CASE WHEN status = 'draft' THEN (SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = quotes.id) END),0) AS draft_value,
       SUM(CASE WHEN status = 'accepted' AND decided_at >= date('now','-90 days') THEN 1 ELSE 0 END) AS won_90d,
       SUM(CASE WHEN status = 'declined' AND decided_at >= date('now','-90 days') THEN 1 ELSE 0 END) AS lost_90d,
       COALESCE(SUM(CASE WHEN status = 'accepted' AND decided_at >= date('now','-90 days') THEN (SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = quotes.id) END),0) AS won_value_90d,
       SUM(CASE WHEN status = 'sent' AND follow_up_on <= date('now') THEN 1 ELSE 0 END) AS follow_ups_due
     FROM quotes`,
  );
}
