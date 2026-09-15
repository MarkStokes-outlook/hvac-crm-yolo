import { z } from 'zod';
import { q, insert, update, nextNumber, type Row } from '../db/index.ts';
import { audit, badRequest, notFound, type Actor } from '../lib/context.ts';
import { nowIso } from '../lib/time.ts';

export function listParts(opts: { search?: string; category?: string } = {}) {
  const where = ['p.active = 1'];
  const params: unknown[] = [];
  if (opts.search) {
    const s = `%${opts.search}%`;
    where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.category LIKE ? OR p.supplier_code LIKE ?)');
    params.push(s, s, s, s);
  }
  if (opts.category) (where.push('p.category = ?'), params.push(opts.category));
  return q.all(
    `SELECT p.*, s.name AS supplier_name,
       COALESCE((SELECT SUM(qty) FROM stock_levels sl JOIN stock_locations l ON l.id = sl.location_id WHERE sl.part_id = p.id AND l.kind = 'depot'),0) AS depot_qty,
       COALESCE((SELECT SUM(qty) FROM stock_levels sl JOIN stock_locations l ON l.id = sl.location_id WHERE sl.part_id = p.id AND l.kind = 'van'),0) AS van_qty,
       COALESCE((SELECT SUM(pl.qty - pl.qty_received) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE pl.part_id = p.id AND po.status IN ('ordered','part_received')),0) AS on_order
     FROM parts p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id WHERE ${where.join(' AND ')} ORDER BY p.category, p.name`,
    ...params,
  );
}

export function getPart(id: number) {
  const p = q.get<Row>('SELECT p.*, s.name AS supplier_name FROM parts p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id WHERE p.id = ?', id);
  if (!p) throw notFound('Part');
  p.levels = q.all('SELECT sl.*, l.name AS location_name, l.kind, e.name AS engineer_name FROM stock_levels sl JOIN stock_locations l ON l.id = sl.location_id LEFT JOIN engineers e ON e.id = l.engineer_id WHERE sl.part_id = ? ORDER BY l.kind, l.name', id);
  p.movements = q.all(
    `SELECT m.*, fl.name AS from_name, tl.name AS to_name, u.name AS user_name, j.job_no, po.po_no FROM stock_movements m
     LEFT JOIN stock_locations fl ON fl.id = m.from_location_id LEFT JOIN stock_locations tl ON tl.id = m.to_location_id LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN jobs j ON j.id = m.job_id LEFT JOIN purchase_orders po ON po.id = m.po_id WHERE m.part_id = ? ORDER BY m.id DESC LIMIT 50`,
    id,
  );
  return p;
}

export function stockLocations() {
  return q.all(
    `SELECT l.*, e.name AS engineer_name, (SELECT COUNT(*) FROM stock_levels sl WHERE sl.location_id = l.id AND sl.qty > 0) AS lines,
       (SELECT COUNT(*) FROM stock_levels sl WHERE sl.location_id = l.id AND sl.qty < sl.min_qty) AS below_min,
       (SELECT COALESCE(SUM(sl.qty * p.unit_cost),0) FROM stock_levels sl JOIN parts p ON p.id = sl.part_id WHERE sl.location_id = l.id) AS value
     FROM stock_locations l LEFT JOIN engineers e ON e.id = l.engineer_id ORDER BY l.kind, l.name`,
  );
}

export function locationStock(locationId: number) {
  const loc = q.get<Row>('SELECT l.*, e.name AS engineer_name FROM stock_locations l LEFT JOIN engineers e ON e.id = l.engineer_id WHERE l.id = ?', locationId);
  if (!loc) throw notFound('Location');
  loc.items = q.all('SELECT sl.*, p.sku, p.name, p.category, p.unit, p.unit_cost FROM stock_levels sl JOIN parts p ON p.id = sl.part_id WHERE sl.location_id = ? ORDER BY p.category, p.name', locationId);
  return loc;
}

/** Where can I find this part right now? Depot and vans, with the nearest van first when a site is given. */
export function findStock(partId: number) {
  return q.all(
    `SELECT sl.qty, l.id AS location_id, l.name AS location_name, l.kind, e.id AS engineer_id, e.name AS engineer_name FROM stock_levels sl JOIN stock_locations l ON l.id = sl.location_id
     LEFT JOIN engineers e ON e.id = l.engineer_id WHERE sl.part_id = ? AND sl.qty > 0 ORDER BY l.kind, sl.qty DESC`,
    partId,
  );
}

export function lowStock() {
  return q.all(
    `SELECT sl.*, p.sku, p.name, p.unit_cost, p.preferred_supplier_id, s.name AS supplier_name, l.name AS location_name, l.kind,
       COALESCE((SELECT SUM(pl.qty - pl.qty_received) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE pl.part_id = p.id AND po.status IN ('ordered','part_received')),0) AS on_order
     FROM stock_levels sl JOIN parts p ON p.id = sl.part_id JOIN stock_locations l ON l.id = sl.location_id LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
     WHERE sl.qty < sl.min_qty ORDER BY l.kind, l.name, p.name`,
  );
}

export const MovementInput = z.object({
  part_id: z.number().int(),
  from_location_id: z.number().int().optional().nullable(),
  to_location_id: z.number().int().optional().nullable(),
  qty: z.number().positive(),
  kind: z.enum(['transfer', 'adjustment', 'receipt', 'return']),
  note: z.string().optional().nullable(),
});

export function moveStock(actor: Actor, raw: z.input<typeof MovementInput>) {
  const m = MovementInput.parse(raw);
  if (!m.from_location_id && !m.to_location_id) throw badRequest('From or to location required');
  q.tx(() => {
    if (m.from_location_id) {
      const lvl = q.get<Row>('SELECT qty FROM stock_levels WHERE part_id = ? AND location_id = ?', m.part_id, m.from_location_id);
      if (m.kind === 'transfer' && (!lvl || lvl.qty < m.qty)) throw badRequest(`Only ${lvl?.qty ?? 0} in stock at that location`);
      q.run('INSERT INTO stock_levels (part_id, location_id, qty) VALUES (?, ?, ?) ON CONFLICT(part_id, location_id) DO UPDATE SET qty = qty - ?', m.part_id, m.from_location_id, -m.qty, m.qty);
    }
    if (m.to_location_id) {
      q.run('INSERT INTO stock_levels (part_id, location_id, qty) VALUES (?, ?, ?) ON CONFLICT(part_id, location_id) DO UPDATE SET qty = qty + ?', m.part_id, m.to_location_id, m.qty, m.qty);
    }
    insert('stock_movements', { ...m, user_id: actor.userId });
  });
  return getPart(m.part_id);
}

export function setStockLevel(actor: Actor, partId: number, locationId: number, data: { qty?: number; min_qty?: number; max_qty?: number; note?: string }) {
  const lvl = q.get<Row>('SELECT * FROM stock_levels WHERE part_id = ? AND location_id = ?', partId, locationId);
  q.tx(() => {
    if (!lvl) insert('stock_levels', { part_id: partId, location_id: locationId, qty: data.qty ?? 0, min_qty: data.min_qty ?? 0, max_qty: data.max_qty ?? 0 });
    else q.run('UPDATE stock_levels SET qty = COALESCE(?, qty), min_qty = COALESCE(?, min_qty), max_qty = COALESCE(?, max_qty) WHERE part_id = ? AND location_id = ?', data.qty ?? null, data.min_qty ?? null, data.max_qty ?? null, partId, locationId);
    if (data.qty != null && data.qty !== (lvl?.qty ?? 0)) {
      const diff = data.qty - (lvl?.qty ?? 0);
      insert('stock_movements', { part_id: partId, [diff > 0 ? 'to_location_id' : 'from_location_id']: locationId, qty: Math.abs(diff), kind: 'adjustment', user_id: actor.userId, note: data.note ?? 'Stock count' });
    }
  });
}

/** Top a van back up to its max levels from the depot. */
export function replenishVan(actor: Actor, vanLocationId: number) {
  const depot = q.get<Row>(`SELECT id FROM stock_locations WHERE kind = 'depot' ORDER BY id LIMIT 1`)!;
  const lines = q.all<Row>('SELECT sl.*, p.name FROM stock_levels sl JOIN parts p ON p.id = sl.part_id WHERE sl.location_id = ? AND sl.qty < sl.max_qty', vanLocationId);
  const moved: Row[] = [];
  const short: Row[] = [];
  for (const l of lines) {
    const need = l.max_qty - l.qty;
    const available = q.get<Row>('SELECT qty FROM stock_levels WHERE part_id = ? AND location_id = ?', l.part_id, depot.id)?.qty ?? 0;
    const qty = Math.min(need, available);
    if (qty > 0) {
      moveStock(actor, { part_id: l.part_id, from_location_id: depot.id, to_location_id: vanLocationId, qty, kind: 'transfer', note: 'Van replenishment' });
      moved.push({ part: l.name, qty });
    }
    if (qty < need) short.push({ part: l.name, short: need - qty });
  }
  return { moved, short };
}

// ─── Suppliers & purchase orders ──────────────────────────────────────────

export const listSuppliers = () =>
  q.all(`SELECT s.*, (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status IN ('ordered','part_received')) AS open_orders FROM suppliers s ORDER BY name`);

export const POInput = z.object({
  supplier_id: z.number().int(),
  job_id: z.number().int().optional().nullable(),
  deliver_to: z.enum(['depot', 'site', 'collect']).default('depot'),
  location_id: z.number().int().optional().nullable(),
  required_by: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z
    .array(z.object({ part_id: z.number().int().optional().nullable(), description: z.string().optional(), qty: z.number().positive(), unit_cost: z.number().min(0).optional() }))
    .min(1),
  place_order: z.boolean().default(false),
});

export function createPurchaseOrder(actor: Actor, raw: z.input<typeof POInput>) {
  const input = POInput.parse(raw);
  if (!q.get('SELECT id FROM suppliers WHERE id = ?', input.supplier_id)) throw notFound('Supplier');
  const poNo = nextNumber('po', 'PO-', 5);
  const depot = q.get<Row>(`SELECT id FROM stock_locations WHERE kind = 'depot' ORDER BY id LIMIT 1`);
  const id = q.tx(() => {
    const pid = insert('purchase_orders', {
      po_no: poNo,
      supplier_id: input.supplier_id,
      job_id: input.job_id ?? null,
      status: input.place_order ? 'ordered' : 'draft',
      ordered_at: input.place_order ? nowIso() : null,
      deliver_to: input.deliver_to,
      location_id: input.location_id ?? (input.deliver_to === 'site' ? null : depot?.id),
      required_by: input.required_by ?? null,
      notes: input.notes ?? null,
      raised_by: actor.userId,
    });
    for (const l of input.lines) {
      const part = l.part_id ? q.get<Row>('SELECT * FROM parts WHERE id = ?', l.part_id) : undefined;
      if (l.part_id && !part) throw notFound(`Part ${l.part_id}`);
      if (!part && !l.description) throw badRequest('Each line needs a part or description');
      insert('po_lines', { po_id: pid, part_id: part?.id ?? null, description: l.description ?? part!.name, qty: l.qty, unit_cost: l.unit_cost ?? part?.unit_cost ?? 0 });
    }
    audit(actor, 'purchase_order', pid, 'created', poNo);
    if (input.job_id) audit(actor, 'job', input.job_id, 'po_raised', poNo);
    return pid;
  });
  return getPurchaseOrder(id);
}

export function getPurchaseOrder(id: number) {
  const po = q.get<Row>(
    `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone, j.job_no, j.title AS job_title, l.name AS location_name, u.name AS raised_by_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN jobs j ON j.id = po.job_id LEFT JOIN stock_locations l ON l.id = po.location_id LEFT JOIN users u ON u.id = po.raised_by WHERE po.id = ?`,
    id,
  );
  if (!po) throw notFound('Purchase order');
  po.lines = q.all('SELECT pl.*, p.sku FROM po_lines pl LEFT JOIN parts p ON p.id = pl.part_id WHERE po_id = ?', id);
  po.total = Math.round(po.lines.reduce((s: number, l: Row) => s + l.qty * l.unit_cost, 0) * 100) / 100;
  return po;
}

export function listPurchaseOrders(opts: { status?: string; job_id?: number } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.status === 'open') where.push(`po.status IN ('draft','ordered','part_received')`);
  else if (opts.status) (where.push('po.status = ?'), p.push(opts.status));
  if (opts.job_id) (where.push('po.job_id = ?'), p.push(opts.job_id));
  return q.all(
    `SELECT po.*, s.name AS supplier_name, j.job_no, COALESCE((SELECT SUM(qty*unit_cost) FROM po_lines WHERE po_id = po.id),0) AS total
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN jobs j ON j.id = po.job_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY po.created_at DESC LIMIT 200`,
    ...p,
  );
}

export function placeOrder(actor: Actor, id: number, supplier_ref?: string) {
  const po = q.get<Row>('SELECT * FROM purchase_orders WHERE id = ?', id);
  if (!po) throw notFound('Purchase order');
  if (po.status !== 'draft') throw badRequest(`PO is already ${po.status}`);
  update('purchase_orders', id, { status: 'ordered', ordered_at: nowIso(), supplier_ref: supplier_ref ?? null });
  audit(actor, 'purchase_order', id, 'ordered', supplier_ref);
  return getPurchaseOrder(id);
}

/** Receive goods against PO lines. Stock goes to the PO's location; job-linked jobs waiting on parts are flagged. */
export function receivePurchaseOrder(actor: Actor, id: number, receipts: { line_id: number; qty: number }[]) {
  const po = q.get<Row>('SELECT * FROM purchase_orders WHERE id = ?', id);
  if (!po) throw notFound('Purchase order');
  if (!['ordered', 'part_received'].includes(po.status)) throw badRequest(`PO is ${po.status}`);
  q.tx(() => {
    for (const r of receipts) {
      if (r.qty <= 0) continue;
      const line = q.get<Row>('SELECT * FROM po_lines WHERE id = ? AND po_id = ?', r.line_id, id);
      if (!line) throw notFound('PO line');
      const qty = Math.min(r.qty, line.qty - line.qty_received);
      if (qty <= 0) continue;
      update('po_lines', line.id, { qty_received: line.qty_received + qty });
      if (line.part_id && po.location_id) {
        q.run('INSERT INTO stock_levels (part_id, location_id, qty) VALUES (?, ?, ?) ON CONFLICT(part_id, location_id) DO UPDATE SET qty = qty + ?', line.part_id, po.location_id, qty, qty);
        insert('stock_movements', { part_id: line.part_id, to_location_id: po.location_id, qty, kind: 'receipt', po_id: id, job_id: po.job_id, user_id: actor.userId });
      }
    }
    const remaining = q.get<{ n: number }>('SELECT COUNT(*) n FROM po_lines WHERE po_id = ? AND qty_received < qty', id)!.n;
    update('purchase_orders', id, { status: remaining ? 'part_received' : 'received' });
    audit(actor, 'purchase_order', id, remaining ? 'part_received' : 'received');
    if (!remaining && po.job_id) {
      const job = q.get<Row>('SELECT * FROM jobs WHERE id = ?', po.job_id);
      if (job?.status === 'on_hold' && job.hold_reason === 'awaiting_parts') {
        update('jobs', job.id, { status: 'new', hold_reason: null, updated_at: nowIso() });
        insert('job_notes', { job_id: job.id, user_id: actor.userId, kind: 'system', body: `Parts received on ${po.po_no} — job ready to schedule return visit` });
        audit(actor, 'job', job.id, 'parts_received', po.po_no);
      }
    }
  });
  return getPurchaseOrder(id);
}
