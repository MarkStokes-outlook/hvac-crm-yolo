import { z } from 'zod';
import { q, getSetting, type Row } from '../db/index.ts';
import { can, forbidden, type Actor } from '../lib/context.ts';
import { DEFAULT_RATES, PRIORITIES, SKILLS, JOB_KINDS } from '../lib/domain.ts';
import { today } from '../lib/time.ts';
import * as crm from '../services/crm.ts';
import * as jobs from '../services/jobs.ts';
import * as sched from '../services/scheduling.ts';
import * as quotes from '../services/quotes.ts';
import * as stock from '../services/stock.ts';
import * as contracts from '../services/contracts.ts';
import * as enquiries from '../services/enquiries.ts';
import * as reports from '../services/reports.ts';

export interface ToolLink {
  type: 'job' | 'customer' | 'site' | 'asset' | 'quote' | 'contract' | 'purchase_order' | 'enquiry' | 'engineer' | 'part';
  id: number;
  label: string;
  action?: 'created' | 'updated' | 'scheduled' | 'viewed';
}

interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** does this tool change data? */
  writes?: boolean;
  allowed?: (a: Actor) => boolean;
  run: (actor: Actor, input: z.infer<S>, links: ToolLink[]) => unknown;
}

const tool = <S extends z.ZodType>(t: ToolDef<S>) => t as unknown as ToolDef;

const id = z.number().int();
const office = (a: Actor) => can.office(a);

/** Drop nulls, data URLs and oversized arrays so tool results stay compact. */
export function compact(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const limit = depth === 0 ? 60 : 25;
    const arr = value.slice(0, limit).map((v) => compact(v, depth + 1));
    if (value.length > limit) arr.push(`… ${value.length - limit} more`);
    return arr;
  }
  if (value && typeof value === 'object') {
    const out: Row = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === '') continue;
      if (k === 'signature' || k === 'password_hash' || k === 'history') continue;
      if (typeof v === 'string' && v.startsWith('data:')) continue;
      out[k] = compact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export const TOOLS: ToolDef[] = [
  tool({
    name: 'search',
    description: 'Search across customers, sites (by name, postcode, town, address), jobs (by number, title, customer PO), quotes, equipment (tag, serial, model) and contacts. Use this first when the user mentions something by name.',
    schema: z.object({ term: z.string().describe('Text to search for, e.g. "Harlow House", "M1 4BT", "J-00042", "Daikin"') }),
    run: (_a, i) => crm.globalSearch(i.term),
  }),
  tool({
    name: 'get_customer',
    description: 'Full customer record: account status (on stop / PO required), sites, contacts, contracts, quotes, recent activity.',
    schema: z.object({ customer_id: id }),
    run: (_a, i, links) => {
      const c = crm.getCustomer(i.customer_id);
      links.push({ type: 'customer', id: c.id, label: c.name, action: 'viewed' });
      return c;
    },
  }),
  tool({
    name: 'get_site',
    description: 'Site details: address, access notes, hazards, induction/DBS requirements, equipment register with F-Gas status, covering contract & SLA terms, PPM plans, job history, open defects and quotes.',
    schema: z.object({ site_id: id }),
    run: (_a, i, links) => {
      const s = crm.getSite(i.site_id);
      links.push({ type: 'site', id: s.id, label: s.name, action: 'viewed' });
      return { ...s, jobs: s.jobs.slice(0, 20) };
    },
  }),
  tool({
    name: 'get_asset',
    description: 'Equipment record with full service history (jobs & engineer work summaries), refrigerant log, F-Gas leak check status, defects and parts used.',
    schema: z.object({ asset_id: id }),
    run: (_a, i, links) => {
      const a = crm.getAsset(i.asset_id);
      links.push({ type: 'asset', id: a.id, label: `${a.tag} ${a.category}`, action: 'viewed' });
      return a;
    },
  }),
  tool({
    name: 'find_jobs',
    description:
      'List jobs with filters. status accepts a comma list (new,scheduled,in_progress,on_hold,completed,closed,cancelled) or "open". sla can be at_risk, breached or at_risk_or_breached. unscheduled=true returns open jobs with no upcoming visit.',
    schema: z.object({
      status: z.string().optional(),
      kind: z.string().optional().describe(`Comma list of: ${Object.keys(JOB_KINDS).join(', ')}`),
      priority: z.string().optional(),
      customer_id: id.optional(),
      site_id: id.optional(),
      asset_id: id.optional(),
      engineer_id: id.optional(),
      contract_id: id.optional(),
      search: z.string().optional(),
      unscheduled: z.boolean().optional(),
      sla: z.enum(['at_risk', 'breached', 'at_risk_or_breached']).optional(),
      invoice_status: z.string().optional(),
      limit: z.number().int().max(100).optional(),
    }),
    run: (_a, i) => jobs.listJobs({ limit: 40, ...i }),
  }),
  tool({
    name: 'get_job',
    description: 'Full job: customer, site & access info, contract/SLA terms and status, equipment, visits, notes, parts, defects, refrigerant records, linked quotes/POs and valuation.',
    schema: z.object({ job_id: id }),
    run: (_a, i, links) => {
      const j = jobs.getJob(i.job_id);
      links.push({ type: 'job', id: j.id, label: `${j.job_no} ${j.title}`, action: 'viewed' });
      return j;
    },
  }),
  tool({
    name: 'create_job',
    description: `Log a new job against a site. SLA targets, contract cover and charge type are worked out automatically from the site's contract. Priorities: ${Object.entries(PRIORITIES)
      .map(([k, v]) => `${k} = ${v.description}`)
      .join('; ')}. Link affected equipment via asset_ids where known (look them up with get_site). Returns the job and any warnings (on stop, PO required, induction etc.) which you must relay.`,
    writes: true,
    allowed: can.manageJobs,
    schema: z.object({
      site_id: id,
      kind: z.enum(['reactive', 'ppm', 'remedial', 'quoted', 'installation', 'survey', 'warranty', 'recall']).default('reactive'),
      priority: z.enum(['P1', 'P2', 'P3', 'P4']),
      title: z.string().describe('Short fault summary, e.g. "Server room AC not cooling"'),
      description: z.string().optional().describe('Fault as reported, with any useful detail (error codes, symptoms, areas affected)'),
      reported_by: z.string().optional(),
      reported_contact_id: id.optional(),
      reported_via: z.enum(['phone', 'email', 'web', 'engineer', 'internal']).default('phone'),
      customer_ref: z.string().optional().describe('Customer PO / work order number'),
      nte_limit: z.number().optional().describe('Not-to-exceed value authorised by the customer (£)'),
      asset_ids: z.array(id).optional(),
      required_skills: z.array(z.string()).optional().describe(`Skill codes: ${Object.keys(SKILLS).join(', ')}. Inferred from equipment if omitted.`),
      est_hours: z.number().optional(),
      parent_job_id: id.optional(),
      enquiry_id: id.optional().describe('Inbox enquiry this job came from (marks it actioned)'),
      override_on_stop: z.boolean().optional().describe('Only set when the user has explicitly confirmed a manager approved work for an on-stop account'),
    }),
    run: (a, i, links) => {
      const r = jobs.createJob(a, i);
      links.push({ type: 'job', id: r.job.id, label: `${r.job.job_no} ${r.job.title}`, action: 'created' });
      return { job: { id: r.job.id, job_no: r.job.job_no, status: r.job.status, priority: r.job.priority, charge_type: r.job.charge_type, contract_ref: r.job.contract_ref, respond_by: r.job.respond_by, fix_by: r.job.fix_by, sla_terms: r.job.sla_terms, required_skills: r.job.required_skills, est_hours: r.job.est_hours }, warnings: r.warnings };
    },
  }),
  tool({
    name: 'update_job',
    description: 'Change a job: priority (recalculates SLA), status (on_hold needs hold_reason: awaiting_parts, awaiting_quote_approval, awaiting_access, awaiting_customer, awaiting_subcontractor, other), title/description, customer PO, estimate, skills, equipment. Cancelling also cancels booked visits — confirm with the user first.',
    writes: true,
    allowed: can.manageJobs,
    schema: z.object({
      job_id: id,
      priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
      status: z.enum(['new', 'on_hold', 'completed', 'closed', 'cancelled']).optional(),
      hold_reason: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      customer_ref: z.string().optional(),
      nte_limit: z.number().optional(),
      est_hours: z.number().optional(),
      required_skills: z.array(z.string()).optional(),
      asset_ids: z.array(id).optional(),
      reason: z.string().optional(),
    }),
    run: (a, { job_id, ...patch }, links) => {
      const j = jobs.updateJob(a, job_id, patch as any);
      links.push({ type: 'job', id: j.id, label: `${j.job_no} ${j.title}`, action: 'updated' });
      return { id: j.id, job_no: j.job_no, status: j.status, hold_reason: j.hold_reason, priority: j.priority, respond_by: j.respond_by, fix_by: j.fix_by, sla: j.sla };
    },
  }),
  tool({
    name: 'add_job_note',
    description: 'Add a note to a job. kind "customer_update" records an update given to the customer.',
    writes: true,
    schema: z.object({ job_id: id, body: z.string(), kind: z.enum(['note', 'customer_update']).default('note') }),
    run: (a, i, links) => {
      jobs.addNote(a, i.job_id, i.body, i.kind);
      links.push({ type: 'job', id: i.job_id, label: 'Job note added', action: 'updated' });
      return { ok: true };
    },
  }),
  tool({
    name: 'list_engineers',
    description: 'All active engineers and subcontractors with grade, team, skills, qualifications (with expiry state) and home postcode.',
    schema: z.object({}),
    run: () => sched.listEngineers().map((e) => ({ id: e.id, name: e.name, kind: e.kind, company: e.company, grade: e.grade, team: e.team, skills: e.skills, home_postcode: e.home_postcode, hours: `${e.day_start}-${e.day_end}`, qualifications: e.qualifications.map((x: Row) => `${x.code}:${x.state}${x.expires_on ? ` (exp ${x.expires_on})` : ''}`) })),
  }),
  tool({
    name: 'suggest_engineers',
    description:
      'Work out who can attend a job: ranks engineers by skills/tickets (F-Gas, Gas Safe, DBS), earliest realistic slot including travel from their previous job, whether that meets the SLA response target, familiarity with the site and workload. Use before scheduling.',
    schema: z.object({
      job_id: id.optional(),
      site_id: id.optional(),
      required_skills: z.array(z.string()).optional(),
      est_hours: z.number().optional(),
      from_date: z.string().optional().describe('YYYY-MM-DD, default today'),
      days: z.number().int().optional().describe('How many days ahead to search (default 7)'),
    }),
    run: (_a, i) => sched.suggestEngineers(i),
  }),
  tool({
    name: 'engineer_availability',
    description: "One engineer's day: booked visits/absences and free slots.",
    schema: z.object({ engineer_id: id, date: z.string().describe('YYYY-MM-DD') }),
    run: (_a, i) => sched.engineerAvailability(i.engineer_id, i.date),
  }),
  tool({
    name: 'get_schedule',
    description: 'Schedule for a date range: every engineer with their visits (job, site, times, status), absences and on-call rota. Optionally filter to one engineer.',
    schema: z.object({ from: z.string().describe('YYYY-MM-DD'), to: z.string().describe('YYYY-MM-DD'), engineer_id: id.optional() }),
    run: (_a, i) => {
      const b = sched.scheduleBoard(i.from, i.to);
      const vis = b.visits.filter((v) => !i.engineer_id || v.engineer_id === i.engineer_id);
      return {
        engineers: b.engineers.filter((e) => !i.engineer_id || e.id === i.engineer_id).map((e) => ({ id: e.id, name: e.name, skills: e.skills })),
        visits: vis.map((v) => ({ visit_id: v.id, engineer_id: v.engineer_id, job_id: v.job_id, job_no: v.job_no, title: v.title, priority: v.priority, site: v.site_name, postcode: v.postcode, starts_at: v.starts_at, ends_at: v.ends_at, status: v.status })),
        absences: b.absences,
        on_call: b.on_call,
      };
    },
  }),
  tool({
    name: 'schedule_visit',
    description: 'Book an engineer onto a job. starts_at must be an ISO datetime with UK offset (e.g. 2026-09-16T09:30:00+01:00). Fails with an explanation if the engineer is busy/absent unless force=true (only when the user explicitly wants to double-book).',
    writes: true,
    allowed: can.schedule,
    schema: z.object({ job_id: id, engineer_id: id, starts_at: z.string(), duration_hours: z.number().optional(), instructions: z.string().optional(), force: z.boolean().optional() }),
    run: (a, i, links) => {
      const r = sched.scheduleVisit(a, i);
      links.push({ type: 'job', id: i.job_id, label: `${r.visit.job_no} → ${r.visit.engineer_name} ${new Date(r.visit.starts_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, action: 'scheduled' });
      return r;
    },
  }),
  tool({
    name: 'reschedule_visit',
    description: 'Move a booked visit to another time and/or engineer.',
    writes: true,
    allowed: can.schedule,
    schema: z.object({ visit_id: id, engineer_id: id.optional(), starts_at: z.string().optional(), ends_at: z.string().optional(), force: z.boolean().optional() }),
    run: (a, { visit_id, ...p }, links) => {
      const r = sched.rescheduleVisit(a, visit_id, p);
      links.push({ type: 'job', id: r.visit.job_id, label: `${r.visit.job_no} moved → ${r.visit.engineer_name}`, action: 'scheduled' });
      return r;
    },
  }),
  tool({
    name: 'cancel_visit',
    description: 'Cancel a booked visit (the job stays open). Confirm with the user before calling.',
    writes: true,
    allowed: can.schedule,
    schema: z.object({ visit_id: id, reason: z.string().optional() }),
    run: (a, i, links) => {
      const v = sched.getVisit(i.visit_id);
      sched.cancelVisit(a, i.visit_id, i.reason);
      links.push({ type: 'job', id: v.job_id, label: `${v.job_no} visit cancelled`, action: 'updated' });
      return { ok: true };
    },
  }),
  tool({
    name: 'find_quotes',
    description: 'List quotes. status: comma list of draft,sent,accepted,declined,expired,cancelled or "open".',
    schema: z.object({ status: z.string().optional(), customer_id: id.optional(), search: z.string().optional() }),
    run: (_a, i) => quotes.listQuotes(i),
  }),
  tool({
    name: 'get_quote',
    description: 'Quote with lines, totals, margin, linked defects and history.',
    schema: z.object({ quote_id: id }),
    run: (_a, i, links) => {
      const qt = quotes.getQuote(i.quote_id);
      links.push({ type: 'quote', id: qt.id, label: `${qt.quote_no} ${qt.title}`, action: 'viewed' });
      return qt;
    },
  }),
  tool({
    name: 'get_rate_card',
    description: 'Current labour rates, callout charges, materials markup and VAT used for pricing quotes and chargeable work.',
    schema: z.object({}),
    run: () => getSetting('rates', DEFAULT_RATES),
  }),
  tool({
    name: 'create_quote',
    description:
      'Create a DRAFT quote. Build realistic lines: labour (hours × rate card, include travel), materials/equipment (use search_parts for catalogue items and prices — unit_price is filled from the catalogue or cost + markup if omitted), access equipment, subcontract. Link defect_ids when quoting for engineer-raised defects. Quotes are never sent automatically.',
    writes: true,
    allowed: can.quotes,
    schema: z.object({
      customer_id: id.optional(),
      site_id: id.optional(),
      contact_id: id.optional(),
      source_job_id: id.optional(),
      defect_ids: z.array(id).optional(),
      kind: z.enum(['repair', 'remedial', 'replacement', 'installation', 'maintenance_contract', 'other']),
      title: z.string(),
      scope: z.string().describe('Customer-facing scope of works'),
      exclusions: z.string().optional(),
      lines: z.array(
        z.object({
          kind: z.enum(['labour', 'materials', 'equipment', 'subcontract', 'access', 'other']),
          part_id: id.optional(),
          description: z.string(),
          qty: z.number(),
          unit_cost: z.number().describe('Our cost per unit (for labour use the engineer cost ~£28/hr)'),
          unit_price: z.number().optional().describe('Sell price per unit'),
        }),
      ),
    }),
    run: (a, i, links) => {
      const qt = quotes.createQuote(a, i);
      links.push({ type: 'quote', id: qt.id, label: `${qt.quote_no} ${qt.title}`, action: 'created' });
      return { id: qt.id, quote_no: qt.quote_no, totals: qt.totals, lines: qt.lines.length };
    },
  }),
  tool({
    name: 'update_quote',
    description: 'Edit a draft/sent quote. Passing lines replaces all lines.',
    writes: true,
    allowed: can.quotes,
    schema: z.object({
      quote_id: id,
      title: z.string().optional(),
      scope: z.string().optional(),
      exclusions: z.string().optional(),
      lines: z.array(z.object({ kind: z.enum(['labour', 'materials', 'equipment', 'subcontract', 'access', 'other']), part_id: id.optional(), description: z.string(), qty: z.number(), unit_cost: z.number(), unit_price: z.number().optional() })).optional(),
    }),
    run: (a, { quote_id, ...p }, links) => {
      const qt = quotes.updateQuote(a, quote_id, p);
      links.push({ type: 'quote', id: qt.id, label: `${qt.quote_no} updated`, action: 'updated' });
      return { id: qt.id, quote_no: qt.quote_no, totals: qt.totals };
    },
  }),
  tool({
    name: 'set_quote_status',
    description: 'Mark a quote sent, accepted (optionally with customer PO), declined (with reason), expired or cancelled. Confirm with the user before accepting/declining.',
    writes: true,
    allowed: can.quotes,
    schema: z.object({ quote_id: id, status: z.enum(['sent', 'accepted', 'declined', 'expired', 'cancelled', 'draft']), decline_reason: z.string().optional(), customer_po: z.string().optional() }),
    run: (a, i, links) => {
      const qt = quotes.setQuoteStatus(a, i.quote_id, i.status, i);
      links.push({ type: 'quote', id: qt.id, label: `${qt.quote_no} → ${i.status}`, action: 'updated' });
      return { id: qt.id, quote_no: qt.quote_no, status: qt.status };
    },
  }),
  tool({
    name: 'convert_quote_to_job',
    description: 'Create the works job from an accepted quote. Returns the job and materials that may need ordering.',
    writes: true,
    allowed: can.quotes,
    schema: z.object({ quote_id: id, target_start_on: z.string().optional(), est_hours: z.number().optional() }),
    run: (a, i, links) => {
      const r = quotes.convertQuoteToJob(a, i.quote_id, i);
      links.push({ type: 'job', id: r.job.id, label: `${r.job.job_no} ${r.job.title}`, action: 'created' });
      return { job: { id: r.job.id, job_no: r.job.job_no, est_hours: r.job.est_hours }, materials_to_order: r.materials_to_order };
    },
  }),
  tool({
    name: 'search_parts',
    description: 'Search the parts catalogue (SKU, name, category) with cost/sell price, preferred supplier, depot stock, stock on vans and quantity on order. Set include_locations to see exactly which vans hold it.',
    schema: z.object({ search: z.string(), include_locations: z.boolean().optional() }),
    run: (_a, i) =>
      stock.listParts({ search: i.search }).slice(0, 15).map((p: Row) => ({ ...p, locations: i.include_locations ? stock.findStock(p.id) : undefined })),
  }),
  tool({
    name: 'low_stock',
    description: 'Stock lines below minimum level at the depot or on vans, with preferred supplier and quantity already on order.',
    schema: z.object({}),
    allowed: office,
    run: () => stock.lowStock(),
  }),
  tool({
    name: 'create_purchase_order',
    description: 'Raise a purchase order to a supplier (draft unless place_order=true). Link job_id when parts are for a specific job — when received the job is released from awaiting parts.',
    writes: true,
    allowed: can.stock,
    schema: z.object({
      supplier_id: id,
      job_id: id.optional(),
      deliver_to: z.enum(['depot', 'site', 'collect']).default('depot'),
      required_by: z.string().optional(),
      notes: z.string().optional(),
      lines: z.array(z.object({ part_id: id.optional(), description: z.string().optional(), qty: z.number(), unit_cost: z.number().optional() })),
      place_order: z.boolean().default(false),
    }),
    run: (a, i, links) => {
      const po = stock.createPurchaseOrder(a, i);
      links.push({ type: 'purchase_order', id: po.id, label: `${po.po_no} ${po.supplier_name} £${po.total}`, action: 'created' });
      return po;
    },
  }),
  tool({
    name: 'list_suppliers',
    description: 'Suppliers with categories, lead times and open orders.',
    schema: z.object({}),
    run: () => stock.listSuppliers(),
  }),
  tool({
    name: 'find_contracts',
    description: 'Maintenance contracts. renewals_within_days lists active contracts ending soon.',
    schema: z.object({ status: z.string().optional(), customer_id: id.optional(), renewals_within_days: z.number().int().optional() }),
    run: (_a, i) => contracts.listContracts(i),
  }),
  tool({
    name: 'get_contract',
    description: 'Contract detail: cover level (PPM only / PPM + reactive / comprehensive), OOH cover, parts/labour inclusions, SLA response & fix times by priority, covered sites, PPM plans and performance.',
    schema: z.object({ contract_id: id }),
    run: (_a, i, links) => {
      const c = contracts.getContract(i.contract_id);
      links.push({ type: 'contract', id: c.id, label: `${c.ref} ${c.name}`, action: 'viewed' });
      return c;
    },
  }),
  tool({
    name: 'ppm_due',
    description: 'Planned maintenance plans due on or before a date, showing whether a job has already been generated.',
    schema: z.object({ due_before: z.string().describe('YYYY-MM-DD') }),
    run: (_a, i) => contracts.listPpmPlans({ due_before: i.due_before }),
  }),
  tool({
    name: 'generate_ppm_jobs',
    description: 'Create PPM jobs for all plans due up to a date (skips ones already generated). Confirm with the user first.',
    writes: true,
    allowed: can.manageJobs,
    schema: z.object({ until: z.string().describe('YYYY-MM-DD') }),
    run: (a, i, links) => {
      const r = contracts.generatePpmJobs(a, i.until);
      for (const j of r.created.slice(0, 10)) links.push({ type: 'job', id: j.id, label: `${j.job_no} ${j.site_name}`, action: 'created' });
      return r;
    },
  }),
  tool({
    name: 'list_enquiries',
    description: 'Service desk inbox (emails, voicemails, web forms). status: open (default), new, actioned, dismissed, all.',
    schema: z.object({ status: z.string().optional() }),
    allowed: office,
    run: (_a, i) => enquiries.listEnquiries(i.status ?? 'open').map((e) => ({ ...e, body: e.body.slice(0, 600) })),
  }),
  tool({
    name: 'get_enquiry',
    description: 'One inbox enquiry with full text and matched customer/contact.',
    schema: z.object({ enquiry_id: id }),
    allowed: office,
    run: (_a, i) => enquiries.getEnquiry(i.enquiry_id),
  }),
  tool({
    name: 'update_enquiry',
    description: 'Mark an enquiry in_progress, actioned or dismissed, or link it to a customer/site/quote.',
    writes: true,
    allowed: office,
    schema: z.object({ enquiry_id: id, status: z.enum(['new', 'in_progress', 'actioned', 'dismissed']).optional(), customer_id: id.optional(), site_id: id.optional(), quote_id: id.optional() }),
    run: (a, { enquiry_id, ...p }, links) => {
      const e = enquiries.updateEnquiry(a, enquiry_id, p);
      links.push({ type: 'enquiry', id: e.id, label: e.subject ?? 'Enquiry', action: 'updated' });
      return { id: e.id, status: e.status };
    },
  }),
  tool({
    name: 'log_activity',
    description: 'Record a call, email, meeting or note against a customer (and optionally site/contact/job/quote), or create a follow-up task with due_on.',
    writes: true,
    allowed: office,
    schema: z.object({
      customer_id: id.optional(),
      site_id: id.optional(),
      contact_id: id.optional(),
      job_id: id.optional(),
      quote_id: id.optional(),
      kind: z.enum(['call', 'email', 'meeting', 'note', 'task']),
      direction: z.enum(['inbound', 'outbound']).optional(),
      subject: z.string(),
      body: z.string().optional(),
      due_on: z.string().optional(),
    }),
    run: (a, i, links) => {
      crm.logActivity(a, i);
      if (i.customer_id) links.push({ type: 'customer', id: i.customer_id, label: `${i.kind}: ${i.subject}`, action: 'updated' });
      return { ok: true };
    },
  }),
  tool({
    name: 'operations_summary',
    description: "Today's operational picture: open/unscheduled/on-hold jobs, SLA risks and breaches, today's visits and progress, engineers absent, inbox, quotes pipeline and follow-ups, contract renewals.",
    schema: z.object({}),
    allowed: office,
    run: (a) => reports.dashboard(a),
  }),
  tool({
    name: 'kpi_report',
    description: 'Performance over the last N days: SLA response/fix compliance, first-time fix rate, recalls, PPM completion, quote win rate, engineer hours and busiest fault sites.',
    schema: z.object({ days: z.number().int().default(90) }),
    allowed: office,
    run: (_a, i) => reports.kpis(i.days),
  }),
  tool({
    name: 'compliance_report',
    description: 'F-Gas leak checks overdue/due soon (and R22 equipment), engineer qualifications expired/expiring, warranties ending within 90 days, open unsafe/urgent defects.',
    schema: z.object({}),
    run: () => reports.compliance(),
  }),
];

export function toolsFor(actor: Actor) {
  return TOOLS.filter((t) => !t.allowed || t.allowed(actor));
}

export function toolDefinitions(actor: Actor) {
  return toolsFor(actor).map((t) => {
    const schema = z.toJSONSchema(t.schema, { io: 'input' }) as Row;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema as { type: 'object'; [k: string]: unknown }, eager_input_streaming: true };
  });
}

export function runTool(actor: Actor, name: string, input: unknown, links: ToolLink[]) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { error: `Unknown tool ${name}` };
  if (t.allowed && !t.allowed(actor)) throw forbidden(`${actor.role} users cannot use ${name}`);
  const parsed = t.schema.safeParse(input ?? {});
  if (!parsed.success) return { error: 'Invalid input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  return compact(t.run({ ...actor, viaAi: t.writes ? true : actor.viaAi }, parsed.data, links));
}

export const toolIsWrite = (name: string) => Boolean(TOOLS.find((t) => t.name === name)?.writes);
export { today };
