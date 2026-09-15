import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZodError, z } from 'zod';
import { q, insert, getSetting, setSetting, UPLOAD_DIR, APP_ROOT, type Row } from './db/index.ts';
import { HttpError, can, ensure, audit, type Actor } from './lib/context.ts';
import { ASSET_CATEGORIES, CATEGORY_SKILLS, DEFAULT_RATES, DEFAULT_SLA, GWP, HOLD_REASONS, JOB_KINDS, PRIORITIES, QUALIFICATIONS, SKILLS, VISIT_OUTCOMES } from './lib/domain.ts';
import { today } from './lib/time.ts';
import * as auth from './services/auth.ts';
import * as crm from './services/crm.ts';
import * as jobs from './services/jobs.ts';
import * as sched from './services/scheduling.ts';
import * as contracts from './services/contracts.ts';
import * as quotes from './services/quotes.ts';
import * as stock from './services/stock.ts';
import * as enquiries from './services/enquiries.ts';
import * as reports from './services/reports.ts';
import { chat, getConversation, listConversations } from './ai/agent.ts';
import * as ai from './ai/features.ts';
import { AI_MODEL, AiUnavailableError, aiConfigured, describeAiError } from './ai/client.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

const COOKIE = 'fl_session';

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const actor = (req: Request) => req.actor!;
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid id');
  return n;
};
/** Engineers may only record work on jobs they have a visit booked on. */
function ensureJobAccess(a: Actor, jobId: number) {
  if (a.role !== 'engineer') return;
  const ok = q.get('SELECT 1 FROM visits WHERE job_id = ? AND engineer_id = ?', jobId, a.engineerId ?? -1);
  ensure(!!ok, 'You are not assigned to this job');
}
const str = (v: unknown) => (typeof v === 'string' && v.length ? v : undefined);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  const api = express.Router();

  // ─── Auth ───────────────────────────────────────────────────────────────
  api.post('/auth/login', (req, res) => {
    const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const result = auth.login(email, password);
    if (!result) throw new HttpError(401, 'Incorrect email or password');
    res.setHeader('Set-Cookie', `${COOKIE}=${result.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 86400}`);
    res.json({ user: result.user });
  });
  api.get('/auth/demo-users', (_req, res) => res.json(auth.demoUsers()));

  api.use((req, _res, next) => {
    const a = auth.actorFromToken(readCookie(req, COOKIE) ?? req.headers.authorization?.replace(/^Bearer /, ''));
    if (!a) throw new HttpError(401, 'Not signed in');
    req.actor = a;
    next();
  });

  api.post('/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) auth.logout(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });
  api.get('/auth/me', (req, res) => {
    const u = q.get<Row>('SELECT * FROM users WHERE id = ?', actor(req).userId)!;
    res.json({ user: auth.publicUser(u) });
  });

  api.get('/meta', (_req, res) =>
    res.json({
      skills: SKILLS,
      qualifications: QUALIFICATIONS,
      asset_categories: ASSET_CATEGORIES,
      category_skills: CATEGORY_SKILLS,
      refrigerants: Object.keys(GWP),
      priorities: PRIORITIES,
      job_kinds: JOB_KINDS,
      hold_reasons: HOLD_REASONS,
      visit_outcomes: VISIT_OUTCOMES,
      rates: getSetting('rates', DEFAULT_RATES),
      default_sla: getSetting('default_sla', DEFAULT_SLA),
      ai: { configured: aiConfigured(), model: AI_MODEL },
      users: q.all(`SELECT id, name, role FROM users WHERE active = 1 ORDER BY name`),
      today: today(),
    }),
  );

  api.get('/search', (req, res) => res.json(crm.globalSearch(String(req.query.q ?? ''))));
  api.get('/dashboard', (req, res) => res.json(reports.dashboard(actor(req))));
  api.get('/reports/kpis', (req, res) => res.json(reports.kpis(Number(req.query.days ?? 90))));
  api.get('/reports/compliance', (_req, res) => res.json(reports.compliance()));

  // ─── Customers / sites / contacts / assets ─────────────────────────────
  api.get('/customers', (req, res) => res.json(crm.listCustomers({ search: str(req.query.search), status: str(req.query.status), sector: str(req.query.sector) })));
  api.post('/customers', (req, res) => {
    ensure(can.crmEdit(actor(req)));
    res.json(crm.createCustomer(actor(req), req.body));
  });
  api.get('/customers/:id', (req, res) => res.json(crm.getCustomer(num(req.params.id))));
  api.patch('/customers/:id', (req, res) => {
    ensure(can.crmEdit(actor(req)));
    if ('on_stop' in req.body) ensure(['admin', 'manager'].includes(actor(req).role), 'Only managers can change account stop status');
    res.json(crm.updateCustomer(actor(req), num(req.params.id), req.body));
  });

  api.get('/sites', (req, res) => res.json(crm.listSites({ search: str(req.query.search), customer_id: req.query.customer_id ? num(req.query.customer_id) : undefined })));
  api.post('/sites', (req, res) => {
    ensure(can.crmEdit(actor(req)));
    res.json(crm.createSite(actor(req), req.body));
  });
  api.get('/sites/:id', (req, res) => res.json(crm.getSite(num(req.params.id))));
  api.patch('/sites/:id', (req, res) => {
    ensure(can.crmEdit(actor(req)));
    res.json(crm.updateSite(actor(req), num(req.params.id), req.body));
  });

  api.post('/contacts', (req, res) => {
    ensure(can.crmEdit(actor(req)));
    res.json(crm.createContact(actor(req), req.body));
  });
  api.patch('/contacts/:id', (req, res) => {
    ensure(can.crmEdit(actor(req)));
    res.json(crm.updateContact(actor(req), num(req.params.id), req.body));
  });

  api.get('/assets', (req, res) => res.json(crm.listAssets({ search: str(req.query.search), site_id: req.query.site_id ? num(req.query.site_id) : undefined, category: str(req.query.category), refrigerant: str(req.query.refrigerant) })));
  api.post('/assets', (req, res) => res.json(crm.createAsset(actor(req), req.body)));
  api.get('/assets/:id', (req, res) => res.json(crm.getAsset(num(req.params.id))));
  api.patch('/assets/:id', (req, res) => res.json(crm.updateAsset(actor(req), num(req.params.id), req.body)));

  api.post('/activities', (req, res) => res.json(crm.logActivity(actor(req), req.body)));
  api.patch('/activities/:id', (req, res) => {
    q.run('UPDATE activities SET done = ? WHERE id = ?', req.body.done ? 1 : 0, num(req.params.id));
    res.json({ ok: true });
  });

  // ─── Jobs ───────────────────────────────────────────────────────────────
  api.get('/jobs', (req, res) => res.json(jobs.listJobs(req.query as any)));
  api.post('/jobs', (req, res) => {
    ensure(can.manageJobs(actor(req)) || actor(req).role === 'sales');
    res.json(jobs.createJob(actor(req), req.body));
  });
  api.get('/jobs/:id', (req, res) => res.json(jobs.getJob(num(req.params.id))));
  api.patch('/jobs/:id', (req, res) => {
    ensure(can.manageJobs(actor(req)));
    res.json(jobs.updateJob(actor(req), num(req.params.id), req.body));
  });
  api.post('/jobs/:id/notes', (req, res) => {
    ensureJobAccess(actor(req), num(req.params.id));
    const { body, kind } = z.object({ body: z.string().min(1), kind: z.enum(['note', 'engineer', 'customer_update']).default('note'), visit_id: z.number().optional() }).parse(req.body);
    jobs.addNote(actor(req), num(req.params.id), body, actor(req).role === 'engineer' ? 'engineer' : kind, req.body.visit_id);
    audit(actor(req), 'job', num(req.params.id), 'note_added');
    res.json({ ok: true });
  });
  api.post('/jobs/:id/parts', (req, res) => {
    ensureJobAccess(actor(req), num(req.params.id));
    res.json({ id: jobs.addPart(actor(req), num(req.params.id), req.body) });
  });
  api.delete('/jobs/:id/parts/:partLineId', (req, res) => {
    ensureJobAccess(actor(req), num(req.params.id));
    jobs.removePart(actor(req), num(req.params.id), num(req.params.partLineId));
    res.json({ ok: true });
  });
  api.post('/jobs/:id/defects', (req, res) => {
    ensureJobAccess(actor(req), num(req.params.id));
    res.json({ id: jobs.addDefect(actor(req), num(req.params.id), req.body) });
  });
  api.post('/jobs/:id/refrigerant', (req, res) => {
    ensureJobAccess(actor(req), num(req.params.id));
    res.json({ id: jobs.addRefrigerantLog(actor(req), num(req.params.id), req.body) });
  });
  api.post('/jobs/:id/invoice', (req, res) => {
    ensure(can.invoicing(actor(req)));
    const { invoice_ref, invoice_value } = z.object({ invoice_ref: z.string().min(1), invoice_value: z.number().optional() }).parse(req.body);
    res.json(jobs.markInvoiced(actor(req), num(req.params.id), invoice_ref, invoice_value));
  });
  api.get('/invoicing', (req, res) => {
    ensure(can.invoicing(actor(req)) || can.manageJobs(actor(req)));
    const rows = q.all<Row>(`SELECT id FROM jobs WHERE invoice_status = 'ready' OR (status = 'completed' AND charge_type IN ('chargeable','quoted') AND invoice_status = 'not_ready') ORDER BY completed_at`);
    res.json(
      rows.map((r) => {
        const j = jobs.getJob(r.id);
        return { id: j.id, job_no: j.job_no, title: j.title, status: j.status, kind: j.kind, charge_type: j.charge_type, customer_name: j.customer_name, customer_id: j.customer_id, site_name: j.site_name, customer_ref: j.customer_ref, po_required: j.po_required, completed_at: j.completed_at, invoice_status: j.invoice_status, valuation: j.valuation, quote_no: j.quote_no, quote_id: j.quote_id, nte_limit: j.nte_limit };
      }),
    );
  });

  // ─── Scheduling & visits ────────────────────────────────────────────────
  api.get('/engineers', (_req, res) => res.json(sched.listEngineers()));
  api.get('/engineers/:id', (req, res) => res.json(sched.getEngineer(num(req.params.id))));
  api.post('/engineers/:id/absences', (req, res) => {
    ensure(can.schedule(actor(req)));
    const input = z.object({ kind: z.enum(['holiday', 'sick', 'training', 'other']), starts_at: z.string(), ends_at: z.string(), notes: z.string().optional() }).parse(req.body);
    const id = insert('absences', { ...input, engineer_id: num(req.params.id) });
    res.json({ id });
  });
  api.delete('/absences/:id', (req, res) => {
    ensure(can.schedule(actor(req)));
    q.run('DELETE FROM absences WHERE id = ?', num(req.params.id));
    res.json({ ok: true });
  });
  api.get('/engineers/:id/availability', (req, res) => res.json(sched.engineerAvailability(num(req.params.id), String(req.query.date ?? today()))));
  api.get('/schedule', (req, res) => res.json(sched.scheduleBoard(String(req.query.from ?? today()), String(req.query.to ?? req.query.from ?? today()))));
  api.post('/schedule/suggest', (req, res) => res.json(sched.suggestEngineers(req.body)));
  api.post('/visits', (req, res) => {
    ensure(can.schedule(actor(req)));
    res.json(sched.scheduleVisit(actor(req), req.body));
  });
  api.patch('/visits/:id', (req, res) => {
    ensure(can.schedule(actor(req)));
    res.json(sched.rescheduleVisit(actor(req), num(req.params.id), req.body));
  });
  api.post('/visits/:id/cancel', (req, res) => {
    ensure(can.schedule(actor(req)));
    sched.cancelVisit(actor(req), num(req.params.id), req.body?.reason);
    res.json({ ok: true });
  });

  // Engineer mobile
  api.get('/me/visits', (req, res) => res.json(sched.myVisits(actor(req), str(req.query.date))));
  api.get('/me/van', (req, res) => {
    const loc = q.get<Row>(`SELECT id FROM stock_locations WHERE engineer_id = ?`, actor(req).engineerId ?? -1);
    res.json(loc ? stock.locationStock(loc.id) : null);
  });
  api.get('/visits/:id', (req, res) => res.json(sched.visitDetail(actor(req), num(req.params.id))));
  api.post('/visits/:id/complete', (req, res) => res.json(sched.completeVisit(actor(req), num(req.params.id), req.body)));
  api.post('/visits/:id/:action', (req, res) => {
    const action = z.enum(['accept', 'travel', 'arrive']).parse(req.params.action);
    res.json(sched.visitAction(actor(req), num(req.params.id), action));
  });
  api.put('/visits/:id/checklist', (req, res) => {
    sched.saveChecklist(actor(req), num(req.params.id), req.body);
    res.json({ ok: true });
  });

  // ─── Attachments ────────────────────────────────────────────────────────
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
  });
  api.post('/attachments', upload.array('files', 10), (req, res) => {
    const { entity_type, entity_id, caption, visit_id } = req.body;
    if (!['job', 'asset', 'site', 'quote', 'customer'].includes(entity_type)) throw new HttpError(400, 'Invalid entity');
    if (entity_type === 'job') ensureJobAccess(actor(req), num(entity_id));
    const files = (req.files as Express.Multer.File[]) ?? [];
    const ids = files.map((f) =>
      insert('attachments', { entity_type, entity_id: num(entity_id), visit_id: visit_id ? num(visit_id) : null, filename: f.originalname, stored_name: f.filename, mime: f.mimetype, size: f.size, caption: caption || null, uploaded_by: actor(req).userId }),
    );
    if (entity_type === 'job') audit(actor(req), 'job', num(entity_id), 'attachment_added', `${files.length} file(s)`);
    res.json({ ids });
  });
  api.get('/attachments/:id/file', (req, res) => {
    const a = q.get<Row>('SELECT * FROM attachments WHERE id = ?', num(req.params.id));
    if (!a) throw new HttpError(404, 'File not found');
    res.type(a.mime ?? 'application/octet-stream');
    res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
  });

  // ─── Contracts & PPM ────────────────────────────────────────────────────
  api.get('/contracts', (req, res) => res.json(contracts.listContracts({ status: str(req.query.status), customer_id: req.query.customer_id ? num(req.query.customer_id) : undefined, renewals_within_days: req.query.renewals ? num(req.query.renewals) : undefined })));
  api.post('/contracts', (req, res) => {
    ensure(can.contracts(actor(req)));
    res.json(contracts.createContract(actor(req), req.body));
  });
  api.get('/contracts/:id', (req, res) => res.json(contracts.getContract(num(req.params.id))));
  api.patch('/contracts/:id', (req, res) => {
    ensure(can.contracts(actor(req)));
    res.json(contracts.updateContract(actor(req), num(req.params.id), req.body));
  });
  api.get('/ppm/plans', (req, res) => res.json(contracts.listPpmPlans({ due_before: str(req.query.due_before), contract_id: req.query.contract_id ? num(req.query.contract_id) : undefined })));
  api.post('/ppm/plans', (req, res) => {
    ensure(can.contracts(actor(req)) || can.manageJobs(actor(req)));
    res.json(contracts.createPpmPlan(actor(req), req.body));
  });
  api.post('/ppm/generate', (req, res) => {
    ensure(can.manageJobs(actor(req)));
    res.json(contracts.generatePpmJobs(actor(req), z.object({ until: z.string() }).parse(req.body).until));
  });
  api.get('/ppm/outstanding', (_req, res) => res.json(contracts.ppmCompliance()));
  api.get('/checklists', (_req, res) => res.json(q.all('SELECT * FROM checklist_templates ORDER BY name').map((t: Row) => ({ ...t, items: JSON.parse(t.items) }))));

  // ─── Quotes ─────────────────────────────────────────────────────────────
  api.get('/quotes', (req, res) => res.json(quotes.listQuotes({ status: str(req.query.status), customer_id: req.query.customer_id ? num(req.query.customer_id) : undefined, search: str(req.query.search) })));
  api.get('/quotes/pipeline', (_req, res) => res.json(quotes.quotePipeline()));
  api.post('/quotes', (req, res) => {
    ensure(can.quotes(actor(req)));
    res.json(quotes.createQuote(actor(req), req.body));
  });
  api.get('/quotes/:id', (req, res) => res.json(quotes.getQuote(num(req.params.id))));
  api.patch('/quotes/:id', (req, res) => {
    ensure(can.quotes(actor(req)));
    res.json(quotes.updateQuote(actor(req), num(req.params.id), req.body));
  });
  api.post('/quotes/:id/status', (req, res) => {
    ensure(can.quotes(actor(req)));
    const body = z.object({ status: z.enum(['sent', 'accepted', 'declined', 'expired', 'cancelled', 'draft']), decline_reason: z.string().optional(), customer_po: z.string().optional() }).parse(req.body);
    if (['accepted', 'declined'].includes(body.status)) ensure(can.approveQuotes(actor(req)) || actor(req).role === 'coordinator');
    res.json(quotes.setQuoteStatus(actor(req), num(req.params.id), body.status, body));
  });
  api.post('/quotes/:id/convert', (req, res) => {
    ensure(can.quotes(actor(req)));
    res.json(quotes.convertQuoteToJob(actor(req), num(req.params.id), req.body ?? {}));
  });

  // ─── Stock & purchasing ─────────────────────────────────────────────────
  api.get('/parts', (req, res) => res.json(stock.listParts({ search: str(req.query.search), category: str(req.query.category) })));
  api.get('/parts/:id', (req, res) => res.json(stock.getPart(num(req.params.id))));
  api.get('/stock/locations', (_req, res) => res.json(stock.stockLocations()));
  api.get('/stock/locations/:id', (req, res) => res.json(stock.locationStock(num(req.params.id))));
  api.get('/stock/low', (_req, res) => res.json(stock.lowStock()));
  api.post('/stock/move', (req, res) => {
    const a = actor(req);
    ensure(can.stock(a) || (a.role === 'engineer' && req.body.kind === 'transfer'));
    res.json(stock.moveStock(a, req.body));
  });
  api.put('/stock/level', (req, res) => {
    ensure(can.stock(actor(req)));
    const { part_id, location_id, ...data } = req.body;
    stock.setStockLevel(actor(req), num(part_id), num(location_id), data);
    res.json({ ok: true });
  });
  api.post('/stock/locations/:id/replenish', (req, res) => {
    ensure(can.stock(actor(req)));
    res.json(stock.replenishVan(actor(req), num(req.params.id)));
  });
  api.get('/suppliers', (_req, res) => res.json(stock.listSuppliers()));
  api.get('/purchase-orders', (req, res) => res.json(stock.listPurchaseOrders({ status: str(req.query.status), job_id: req.query.job_id ? num(req.query.job_id) : undefined })));
  api.post('/purchase-orders', (req, res) => {
    ensure(can.stock(actor(req)));
    res.json(stock.createPurchaseOrder(actor(req), req.body));
  });
  api.get('/purchase-orders/:id', (req, res) => res.json(stock.getPurchaseOrder(num(req.params.id))));
  api.post('/purchase-orders/:id/order', (req, res) => {
    ensure(can.stock(actor(req)));
    res.json(stock.placeOrder(actor(req), num(req.params.id), req.body?.supplier_ref));
  });
  api.post('/purchase-orders/:id/receive', (req, res) => {
    ensure(can.stock(actor(req)));
    res.json(stock.receivePurchaseOrder(actor(req), num(req.params.id), req.body.lines ?? []));
  });

  // ─── Enquiries (service desk inbox) ─────────────────────────────────────
  api.get('/enquiries', (req, res) => res.json(enquiries.listEnquiries(String(req.query.status ?? 'open'))));
  api.post('/enquiries', (req, res) => res.json(enquiries.createEnquiry(actor(req), req.body)));
  api.get('/enquiries/:id', (req, res) => res.json(enquiries.getEnquiry(num(req.params.id))));
  api.patch('/enquiries/:id', (req, res) => res.json(enquiries.updateEnquiry(actor(req), num(req.params.id), req.body)));

  // ─── Admin ──────────────────────────────────────────────────────────────
  api.get('/settings', (req, res) => {
    ensure(can.office(actor(req)));
    res.json({ rates: getSetting('rates', DEFAULT_RATES), default_sla: getSetting('default_sla', DEFAULT_SLA) });
  });
  api.put('/settings/:key', (req, res) => {
    ensure(['admin', 'manager'].includes(actor(req).role));
    if (!['rates', 'default_sla'].includes(req.params.key)) throw new HttpError(400, 'Unknown setting');
    setSetting(req.params.key, req.body);
    res.json({ ok: true });
  });
  api.get('/audit', (req, res) => {
    ensure(['admin', 'manager'].includes(actor(req).role));
    res.json(q.all(`SELECT al.*, u.name AS user_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.id DESC LIMIT 200`));
  });

  // ─── AI ─────────────────────────────────────────────────────────────────
  api.get('/ai/conversations', (req, res) => res.json(listConversations(actor(req))));
  api.get('/ai/conversations/:id', (req, res) => res.json(getConversation(actor(req), num(req.params.id))));
  api.post('/ai/chat', async (req, res) => {
    const body = z.object({ conversation_id: z.number().optional(), message: z.string().min(1), page: z.any().optional() }).parse(req.body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const emit = (e: object) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      await chat(actor(req), body, emit);
    } catch (err) {
      emit({ type: 'error', message: err instanceof AiUnavailableError ? err.message : describeAiError(err) });
    }
    res.end();
  });
  api.post('/ai/triage', async (req, res) => {
    const body = z.object({ text: z.string().min(3), enquiry_id: z.number().optional(), from_email: z.string().nullish(), from_phone: z.string().nullish(), from_name: z.string().nullish(), customer_id: z.number().nullish(), site_id: z.number().nullish() }).parse(req.body);
    let input = body;
    if (body.enquiry_id) {
      const e = enquiries.getEnquiry(body.enquiry_id);
      input = { ...body, from_email: e.from_email, from_phone: e.from_phone, from_name: e.from_name, customer_id: e.customer_id, site_id: e.site_id };
    }
    const result = await ai.triage(input);
    if (body.enquiry_id) q.run('UPDATE enquiries SET triage = ? WHERE id = ?', JSON.stringify(result), body.enquiry_id);
    res.json(result);
  });
  api.post('/ai/draft-quote', async (req, res) => {
    ensure(can.quotes(actor(req)));
    res.json(await ai.draftQuote(actor(req), req.body));
  });
  api.post('/ai/site-briefing', async (req, res) => res.json({ text: await ai.siteBriefing(num(req.body.site_id), req.body.job_id ? num(req.body.job_id) : undefined) }));
  api.post('/ai/tidy-notes', async (req, res) => res.json({ text: await ai.tidyWorkNotes(String(req.body.text ?? ''), req.body.context) }));
  api.post('/ai/customer-update', async (req, res) => res.json({ text: await ai.customerUpdate(num(req.body.job_id), req.body.tone === 'sms' ? 'sms' : 'email') }));

  api.use((_req, _res) => {
    throw new HttpError(404, 'Not found');
  });

  app.use('/api', api);

  // Production: serve built SPA
  const dist = path.join(APP_ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`) });
    if (err instanceof AiUnavailableError) return res.status(503).json({ error: err.message, ai_unavailable: true });
    const msg = describeAiError(err);
    console.error(err);
    res.status(500).json({ error: msg });
  });

  return app;
}
