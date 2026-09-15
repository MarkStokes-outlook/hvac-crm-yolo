import { z } from 'zod';
import { q, insert, update, nextNumber, parseJson, type Row } from '../db/index.ts';
import { audit, notFound, badRequest, type Actor } from '../lib/context.ts';
import { fgasStatus } from '../lib/compliance.ts';
import { slaState, contractForSite } from './sla.ts';

const like = (s: string) => `%${s.trim()}%`;

// ─── Customers ────────────────────────────────────────────────────────────

export function listCustomers(opts: { search?: string; status?: string; sector?: string } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.search) {
    where.push(`(c.name LIKE ? OR c.account_no LIKE ? OR c.id IN (SELECT customer_id FROM sites WHERE name LIKE ? OR postcode LIKE ? OR town LIKE ?) OR c.id IN (SELECT customer_id FROM contacts WHERE name LIKE ? OR email LIKE ?))`);
    const s = like(opts.search);
    p.push(s, s, s, s, s, s, s);
  }
  if (opts.status) (where.push('c.status = ?'), p.push(opts.status));
  if (opts.sector) (where.push('c.sector = ?'), p.push(opts.sector));
  return q.all(
    `SELECT c.*, u.name AS account_manager_name,
       (SELECT COUNT(*) FROM sites s WHERE s.customer_id = c.id AND s.active = 1) AS site_count,
       (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND j.status IN ('new','scheduled','in_progress','on_hold')) AS open_jobs,
       (SELECT GROUP_CONCAT(ct.ref) FROM contracts ct WHERE ct.customer_id = c.id AND ct.status = 'active') AS active_contracts
     FROM customers c LEFT JOIN users u ON u.id = c.account_manager_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name`,
    ...p,
  );
}

export function getCustomer(id: number) {
  const c = q.get<Row>('SELECT c.*, u.name AS account_manager_name FROM customers c LEFT JOIN users u ON u.id = c.account_manager_id WHERE c.id = ?', id);
  if (!c) throw notFound('Customer');
  c.sites = q.all(
    `SELECT s.*, (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id AND a.status != 'decommissioned') AS asset_count,
       (SELECT COUNT(*) FROM jobs j WHERE j.site_id = s.id AND j.status IN ('new','scheduled','in_progress','on_hold')) AS open_jobs,
       ec.name AS end_client_name
     FROM sites s LEFT JOIN customers ec ON ec.id = s.end_client_id WHERE s.customer_id = ? ORDER BY s.name`,
    id,
  );
  c.contacts = q.all('SELECT ct.*, s.name AS site_name FROM contacts ct LEFT JOIN sites s ON s.id = ct.site_id WHERE ct.customer_id = ? ORDER BY ct.is_primary DESC, ct.name', id).map((x) => ({ ...x, roles: parseJson(x.roles, []) }));
  c.contracts = q.all('SELECT ct.*, (SELECT COUNT(*) FROM contract_sites cs WHERE cs.contract_id = ct.id) AS site_count FROM contracts ct WHERE ct.customer_id = ? ORDER BY ct.status, ct.ends_on DESC', id);
  c.quotes = q.all(`SELECT qt.*, s.name AS site_name, (SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = qt.id) AS total FROM quotes qt LEFT JOIN sites s ON s.id = qt.site_id WHERE qt.customer_id = ? ORDER BY qt.created_at DESC`, id);
  c.activities = q.all('SELECT a.*, u.name AS user_name, ct.name AS contact_name FROM activities a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN contacts ct ON ct.id = a.contact_id WHERE a.customer_id = ? ORDER BY a.created_at DESC LIMIT 50', id);
  c.stats = q.get(
    `SELECT COUNT(*) AS jobs_12m,
       SUM(CASE WHEN kind = 'reactive' THEN 1 ELSE 0 END) AS reactive_12m,
       SUM(CASE WHEN status IN ('new','scheduled','in_progress','on_hold') THEN 1 ELSE 0 END) AS open_jobs,
       SUM(CASE WHEN invoice_status = 'invoiced' THEN COALESCE(invoice_value,0) ELSE 0 END) AS invoiced_12m
     FROM jobs WHERE customer_id = ? AND created_at >= date('now','-12 months')`,
    id,
  );
  c.managed_sites = q.all('SELECT s.id, s.name, s.postcode, cu.name AS customer_name, cu.id AS customer_id FROM sites s JOIN customers cu ON cu.id = s.customer_id WHERE s.end_client_id = ?', id);
  return c;
}

export const CustomerInput = z.object({
  name: z.string().min(2),
  kind: z.enum(['end_client', 'managing_agent', 'fm_provider', 'main_contractor', 'public_sector']).default('end_client'),
  sector: z.string().optional().nullable(),
  status: z.enum(['prospect', 'active', 'inactive']).default('active'),
  on_stop: z.boolean().optional(),
  on_stop_reason: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  billing_address: z.string().optional().nullable(),
  billing_postcode: z.string().optional().nullable(),
  invoice_email: z.string().optional().nullable(),
  payment_terms_days: z.number().int().optional(),
  po_required: z.boolean().optional(),
  vat_number: z.string().optional().nullable(),
  account_manager_id: z.number().int().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export function createCustomer(actor: Actor, raw: z.input<typeof CustomerInput>) {
  const input = CustomerInput.parse(raw);
  const dupe = q.get<Row>('SELECT id, name FROM customers WHERE lower(name) = lower(?)', input.name);
  if (dupe) throw badRequest(`A customer called "${dupe.name}" already exists (id ${dupe.id})`);
  const id = insert('customers', { ...input, account_no: nextNumber('customer', 'FL', 4) });
  audit(actor, 'customer', id, 'created', input.name);
  return getCustomer(id);
}

export function updateCustomer(actor: Actor, id: number, raw: Partial<z.input<typeof CustomerInput>>) {
  const input = CustomerInput.partial().parse(raw);
  if (!q.get('SELECT id FROM customers WHERE id = ?', id)) throw notFound('Customer');
  update('customers', id, input);
  audit(actor, 'customer', id, 'updated', Object.keys(input).join(', '));
  return getCustomer(id);
}

// ─── Sites ────────────────────────────────────────────────────────────────

export function listSites(opts: { search?: string; customer_id?: number } = {}) {
  const where: string[] = ['s.active = 1'];
  const p: unknown[] = [];
  if (opts.search) {
    const s = like(opts.search);
    where.push('(s.name LIKE ? OR s.postcode LIKE ? OR s.town LIKE ? OR s.address LIKE ? OR c.name LIKE ? OR s.site_code LIKE ?)');
    p.push(s, s, s, s, s, s);
  }
  if (opts.customer_id) (where.push('s.customer_id = ?'), p.push(opts.customer_id));
  return q.all(
    `SELECT s.id, s.name, s.site_code, s.address, s.town, s.postcode, s.building_type, s.customer_id, c.name AS customer_name,
       (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id AND a.status != 'decommissioned') AS asset_count,
       (SELECT ct.ref FROM contracts ct JOIN contract_sites cs ON cs.contract_id = ct.id WHERE cs.site_id = s.id AND ct.status = 'active' LIMIT 1) AS contract_ref
     FROM sites s JOIN customers c ON c.id = s.customer_id WHERE ${where.join(' AND ')} ORDER BY c.name, s.name LIMIT 300`,
    ...p,
  );
}

export function getSite(id: number) {
  const s = q.get<Row>('SELECT s.*, c.name AS customer_name, c.on_stop, c.po_required, ec.name AS end_client_name FROM sites s JOIN customers c ON c.id = s.customer_id LEFT JOIN customers ec ON ec.id = s.end_client_id WHERE s.id = ?', id);
  if (!s) throw notFound('Site');
  s.assets = q.all('SELECT * FROM assets WHERE site_id = ? ORDER BY status = \'decommissioned\', tag', id).map((a) => ({ ...a, fgas: fgasStatus(a) }));
  s.contacts = q.all('SELECT * FROM contacts WHERE (site_id = ? OR (customer_id = ? AND site_id IS NULL)) AND active = 1 ORDER BY site_id IS NULL, name', id, s.customer_id).map((x) => ({ ...x, roles: parseJson(x.roles, []) }));
  const contract = contractForSite(id);
  s.contract = contract ? { ...contract, sla: q.all('SELECT * FROM contract_sla WHERE contract_id = ? ORDER BY priority', contract.id) } : null;
  s.ppm_plans = q.all('SELECT p.*, ct.ref AS contract_ref FROM ppm_plans p JOIN contracts ct ON ct.id = p.contract_id WHERE p.site_id = ? AND p.active = 1 ORDER BY p.next_due_on', id);
  s.jobs = q
    .all<Row>(
      `SELECT j.id, j.job_no, j.kind, j.priority, j.status, j.title, j.created_at, j.completed_at, j.respond_by, j.fix_by, j.attended_at, j.hold_reason,
         (SELECT GROUP_CONCAT(DISTINCT e.name) FROM visits v JOIN engineers e ON e.id = v.engineer_id WHERE v.job_id = j.id AND v.status != 'cancelled') AS engineers
       FROM jobs j WHERE j.site_id = ? ORDER BY j.created_at DESC LIMIT 100`,
      id,
    )
    .map((j) => ({ ...j, sla: slaState(j as any) }));
  s.defects = q.all(`SELECT d.*, a.tag AS asset_tag, j.job_no, qt.quote_no FROM defects d LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN jobs j ON j.id = d.job_id LEFT JOIN quotes qt ON qt.id = d.quote_id WHERE d.site_id = ? ORDER BY d.status = 'resolved', d.created_at DESC`, id);
  s.quotes = q.all(`SELECT qt.id, qt.quote_no, qt.title, qt.status, qt.created_at, (SELECT SUM(qty*unit_price) FROM quote_lines WHERE quote_id = qt.id) AS total FROM quotes qt WHERE qt.site_id = ? ORDER BY qt.created_at DESC`, id);
  return s;
}

export const SiteInput = z.object({
  customer_id: z.number().int(),
  end_client_id: z.number().int().optional().nullable(),
  name: z.string().min(2),
  site_code: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  town: z.string().optional().nullable(),
  county: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  building_type: z.string().optional().nullable(),
  opening_hours: z.string().optional().nullable(),
  access_notes: z.string().optional().nullable(),
  parking_notes: z.string().optional().nullable(),
  hazards: z.string().optional().nullable(),
  induction_required: z.boolean().optional(),
  permit_to_work: z.boolean().optional(),
  dbs_required: z.boolean().optional(),
  ooh_access: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export function createSite(actor: Actor, raw: z.input<typeof SiteInput>) {
  const input = SiteInput.parse(raw);
  if (!q.get('SELECT id FROM customers WHERE id = ?', input.customer_id)) throw notFound('Customer');
  if (input.lat == null && input.postcode) Object.assign(input, approxLocation(input.postcode));
  const id = insert('sites', input);
  audit(actor, 'site', id, 'created', input.name);
  return getSite(id);
}

export function updateSite(actor: Actor, id: number, raw: Partial<z.input<typeof SiteInput>>) {
  const input = SiteInput.partial().parse(raw);
  if (input.postcode && input.lat == null) Object.assign(input, approxLocation(input.postcode));
  update('sites', id, input);
  audit(actor, 'site', id, 'updated', Object.keys(input).join(', '));
  return getSite(id);
}

// Approximate centroid by postcode area/district for travel estimates (no external geocoder needed locally).
const DISTRICTS: Record<string, [number, number]> = {
  M: [53.4808, -2.2426], BL: [53.578, -2.43], OL: [53.5409, -2.1114], SK: [53.4106, -2.1575], WN: [53.545, -2.6325], WA: [53.39, -2.5967],
  L: [53.4084, -2.9916], CH: [53.1934, -2.8931], CW: [53.0979, -2.4416], PR: [53.7632, -2.7031], BB: [53.7486, -2.4875], LA: [54.0466, -2.8007],
  FY: [53.8175, -3.0357], BD: [53.795, -1.7594], LS: [53.8008, -1.5491], HX: [53.7248, -1.8658], HD: [53.6458, -1.785], WF: [53.683, -1.4977],
  WN8: [53.55, -2.78], SK9: [53.3256, -2.2346], M1: [53.4794, -2.2359], M2: [53.4808, -2.2446], M3: [53.4839, -2.2512], M4: [53.4851, -2.2311],
};
export function approxLocation(postcode: string): { lat: number; lng: number } | {} {
  const outward = postcode.toUpperCase().trim().split(/\s+/)[0];
  const area = outward.match(/^[A-Z]+/)?.[0] ?? '';
  const hit = DISTRICTS[outward] ?? DISTRICTS[area];
  return hit ? { lat: hit[0], lng: hit[1] } : {};
}

// ─── Contacts ─────────────────────────────────────────────────────────────

export const ContactInput = z.object({
  customer_id: z.number().int(),
  site_id: z.number().int().optional().nullable(),
  name: z.string().min(2),
  job_title: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  roles: z.array(z.string()).default([]),
  is_primary: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

export function createContact(actor: Actor, raw: z.input<typeof ContactInput>) {
  const input = ContactInput.parse(raw);
  const id = insert('contacts', input);
  audit(actor, 'customer', input.customer_id, 'contact_added', input.name);
  return q.get('SELECT * FROM contacts WHERE id = ?', id);
}

export function updateContact(actor: Actor, id: number, raw: Partial<z.input<typeof ContactInput>>) {
  const input = ContactInput.partial().parse(raw);
  const c = q.get<Row>('SELECT * FROM contacts WHERE id = ?', id);
  if (!c) throw notFound('Contact');
  update('contacts', id, input);
  audit(actor, 'customer', c.customer_id, 'contact_updated', c.name);
  return q.get('SELECT * FROM contacts WHERE id = ?', id);
}

// ─── Assets ───────────────────────────────────────────────────────────────

export function listAssets(opts: { search?: string; site_id?: number; category?: string; refrigerant?: string } = {}) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.search) {
    const s = like(opts.search);
    where.push('(a.tag LIKE ? OR a.manufacturer LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ? OR a.location LIKE ? OR a.category LIKE ? OR s.name LIKE ?)');
    p.push(s, s, s, s, s, s, s);
  }
  if (opts.site_id) (where.push('a.site_id = ?'), p.push(opts.site_id));
  if (opts.category) (where.push('a.category = ?'), p.push(opts.category));
  if (opts.refrigerant) (where.push('a.refrigerant = ?'), p.push(opts.refrigerant));
  return q
    .all<Row>(
      `SELECT a.*, s.name AS site_name, s.postcode, c.name AS customer_name, c.id AS customer_id FROM assets a JOIN sites s ON s.id = a.site_id JOIN customers c ON c.id = s.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name, s.name, a.tag LIMIT 500`,
      ...p,
    )
    .map((a) => ({ ...a, fgas: fgasStatus(a) }));
}

export function getAsset(id: number) {
  const a = q.get<Row>('SELECT a.*, s.name AS site_name, s.customer_id, c.name AS customer_name, pa.tag AS parent_tag FROM assets a JOIN sites s ON s.id = a.site_id JOIN customers c ON c.id = s.customer_id LEFT JOIN assets pa ON pa.id = a.parent_asset_id WHERE a.id = ?', id);
  if (!a) throw notFound('Asset');
  a.fgas = fgasStatus(a);
  a.children = q.all('SELECT id, tag, category, location, status FROM assets WHERE parent_asset_id = ?', id);
  a.jobs = q.all(
    `SELECT j.id, j.job_no, j.kind, j.status, j.title, j.created_at, j.completed_at, j.resolution, j.cause,
       (SELECT GROUP_CONCAT(v.work_summary, ' | ') FROM visits v WHERE v.job_id = j.id AND v.work_summary IS NOT NULL) AS work_summaries,
       (SELECT GROUP_CONCAT(DISTINCT e.name) FROM visits v JOIN engineers e ON e.id = v.engineer_id WHERE v.job_id = j.id AND v.status != 'cancelled') AS engineers
     FROM jobs j JOIN job_assets ja ON ja.job_id = j.id WHERE ja.asset_id = ? ORDER BY j.created_at DESC`,
    id,
  );
  a.refrigerant_logs = q.all('SELECT r.*, e.name AS engineer_name, j.job_no FROM refrigerant_logs r LEFT JOIN engineers e ON e.id = r.engineer_id LEFT JOIN jobs j ON j.id = r.job_id WHERE r.asset_id = ? ORDER BY r.logged_on DESC', id);
  a.defects = q.all('SELECT d.*, j.job_no, qt.quote_no FROM defects d LEFT JOIN jobs j ON j.id = d.job_id LEFT JOIN quotes qt ON qt.id = d.quote_id WHERE d.asset_id = ? ORDER BY d.created_at DESC', id);
  a.parts_used = q.all('SELECT jp.description, jp.qty, jp.created_at, j.job_no FROM job_parts jp JOIN jobs j ON j.id = jp.job_id JOIN job_assets ja ON ja.job_id = j.id WHERE ja.asset_id = ? ORDER BY jp.created_at DESC LIMIT 30', id);
  a.attachments = q.all(`SELECT * FROM attachments WHERE entity_type = 'asset' AND entity_id = ? ORDER BY created_at DESC`, id);
  return a;
}

export const AssetInput = z.object({
  site_id: z.number().int(),
  parent_asset_id: z.number().int().optional().nullable(),
  tag: z.string().optional(),
  category: z.string(),
  description: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  install_date: z.string().optional().nullable(),
  installed_by_us: z.boolean().optional(),
  warranty_expires: z.string().optional().nullable(),
  refrigerant: z.string().optional().nullable(),
  refrigerant_kg: z.number().optional().nullable(),
  leak_detection: z.boolean().optional(),
  capacity_kw: z.number().optional().nullable(),
  fuel: z.string().optional().nullable(),
  status: z.enum(['operational', 'faulty', 'out_of_service', 'decommissioned']).optional(),
  condition: z.enum(['good', 'fair', 'poor', 'end_of_life']).optional().nullable(),
  last_leak_check_on: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export function createAsset(actor: Actor, raw: z.input<typeof AssetInput>) {
  const input = AssetInput.parse(raw);
  if (!q.get('SELECT id FROM sites WHERE id = ?', input.site_id)) throw notFound('Site');
  const tag = input.tag || `EQ-${input.site_id}-${String((q.get<{ n: number }>('SELECT COUNT(*) n FROM assets WHERE site_id = ?', input.site_id)!.n + 1)).padStart(3, '0')}`;
  const id = insert('assets', { ...input, tag });
  audit(actor, 'asset', id, 'created', `${tag} ${input.category}`);
  return getAsset(id);
}

export function updateAsset(actor: Actor, id: number, raw: Partial<z.input<typeof AssetInput>>) {
  const input = AssetInput.partial().parse(raw);
  if (!q.get('SELECT id FROM assets WHERE id = ?', id)) throw notFound('Asset');
  update('assets', id, input);
  audit(actor, 'asset', id, 'updated', Object.keys(input).join(', '));
  return getAsset(id);
}

// ─── Activities ───────────────────────────────────────────────────────────

export const ActivityInput = z.object({
  customer_id: z.number().int().optional().nullable(),
  site_id: z.number().int().optional().nullable(),
  contact_id: z.number().int().optional().nullable(),
  job_id: z.number().int().optional().nullable(),
  quote_id: z.number().int().optional().nullable(),
  kind: z.enum(['call', 'email', 'meeting', 'note', 'task']),
  direction: z.enum(['inbound', 'outbound']).optional().nullable(),
  subject: z.string().min(2),
  body: z.string().optional().nullable(),
  due_on: z.string().optional().nullable(),
});

export function logActivity(actor: Actor, raw: z.input<typeof ActivityInput>) {
  const input = ActivityInput.parse(raw);
  const id = insert('activities', { ...input, user_id: actor.userId });
  return q.get('SELECT * FROM activities WHERE id = ?', id);
}

export function myTasks(actor: Actor) {
  return q.all(
    `SELECT a.*, c.name AS customer_name FROM activities a LEFT JOIN customers c ON c.id = a.customer_id WHERE a.kind = 'task' AND a.done = 0 AND a.user_id = ? ORDER BY a.due_on`,
    actor.userId,
  );
}

// ─── Global search ────────────────────────────────────────────────────────

export function globalSearch(term: string) {
  const s = like(term);
  return {
    customers: q.all('SELECT id, name, account_no, status FROM customers WHERE name LIKE ? OR account_no LIKE ? ORDER BY name LIMIT 6', s, s),
    sites: q.all('SELECT s.id, s.name, s.postcode, s.town, c.name AS customer_name FROM sites s JOIN customers c ON c.id = s.customer_id WHERE s.name LIKE ? OR s.postcode LIKE ? OR s.address LIKE ? OR s.town LIKE ? ORDER BY s.name LIMIT 6', s, s, s, s),
    jobs: q.all('SELECT j.id, j.job_no, j.title, j.status, j.priority, s.name AS site_name FROM jobs j JOIN sites s ON s.id = j.site_id WHERE j.job_no LIKE ? OR j.title LIKE ? OR j.customer_ref LIKE ? ORDER BY j.created_at DESC LIMIT 6', s, s, s),
    quotes: q.all('SELECT id, quote_no, title, status FROM quotes WHERE quote_no LIKE ? OR title LIKE ? ORDER BY created_at DESC LIMIT 5', s, s),
    assets: q.all('SELECT a.id, a.tag, a.category, a.manufacturer, a.model, s.name AS site_name FROM assets a JOIN sites s ON s.id = a.site_id WHERE a.tag LIKE ? OR a.serial_number LIKE ? OR a.model LIKE ? LIMIT 5', s, s, s),
    contacts: q.all('SELECT ct.id, ct.name, ct.phone, ct.email, ct.customer_id, c.name AS customer_name FROM contacts ct JOIN customers c ON c.id = ct.customer_id WHERE ct.name LIKE ? OR ct.email LIKE ? OR ct.phone LIKE ? OR ct.mobile LIKE ? LIMIT 5', s, s, s, s),
  };
}
