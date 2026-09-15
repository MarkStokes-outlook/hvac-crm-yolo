import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { q, getSetting, type Row } from '../db/index.ts';
import { badRequest, type Actor } from '../lib/context.ts';
import { DEFAULT_RATES, PRIORITIES, SKILLS } from '../lib/domain.ts';
import { AI_MODEL, AiUnavailableError, FALLBACK_BETA, aiConfigured, anthropic } from './client.ts';
import { compact } from './tools.ts';
import * as crm from '../services/crm.ts';
import * as jobs from '../services/jobs.ts';
import { matchSender } from '../services/enquiries.ts';
import { listParts } from '../services/stock.ts';

/** Structured single-shot call with refusal fallback. */
async function structured<T extends z.ZodType>(schema: T, system: string, user: string, effort: 'low' | 'medium' | 'high' = 'low'): Promise<z.infer<T>> {
  if (!aiConfigured()) throw new AiUnavailableError();
  const res = await anthropic().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'adaptive' },
    output_config: { effort, format: betaZodOutputFormat(schema) },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw badRequest('The AI declined this request.');
  if (!res.parsed_output) throw badRequest('The AI response could not be parsed. Try again.');
  return res.parsed_output as z.infer<T>;
}

async function text(system: string, user: string, effort: 'low' | 'medium' = 'low') {
  if (!aiConfigured()) throw new AiUnavailableError();
  const res = await anthropic().beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'adaptive' },
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw badRequest('The AI declined this request.');
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
    .trim();
}

// ─── Enquiry / fault triage ───────────────────────────────────────────────

const TriageSchema = z.object({
  request_type: z.enum(['fault', 'quote_request', 'maintenance_booking', 'follow_up', 'invoice_query', 'general', 'not_relevant']),
  summary: z.string().describe('One-line job title, e.g. "Server room AC unit not cooling"'),
  fault_description: z.string().describe('Clean description of the problem/request for the job record'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  priority_reason: z.string(),
  customer_name_mentioned: z.string().nullable(),
  site_mentioned: z.string().nullable().describe('Site name, address or postcode mentioned'),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  customer_ref: z.string().nullable().describe('PO / work order number if given'),
  equipment_hints: z.array(z.string()).describe('Equipment mentioned: type, make, location, error codes'),
  required_skills: z.array(z.string()),
  access_constraints: z.string().nullable(),
  suggested_reply: z.string().describe('Short acknowledgement email to the sender (UK English, no promises of specific times)'),
});
export type Triage = z.infer<typeof TriageSchema> & { source: 'ai' | 'rules'; site_candidates: Row[]; customer_candidates: Row[]; asset_candidates: Row[] };

const P1_WORDS = /(no heat|no heating|heating (has )?(failed|off)|care home|server room|comms room|data (room|centre)|cold ?room|freezer|chiller (down|failed|tripped)|refrigerat\w* (failed|down)|stock at risk|gas smell|smell of gas|burning smell|smoke|water pouring|flood|electrical (fault|burning)|vulnerable|residents|patients|pharmacy)/i;
const P2_WORDS = /(not cooling|not heating|no cooling|too hot|too cold|several units|multiple units|whole floor|kitchen extract|extract (fan )?(failed|down|not working)|leaking|water leak|tripping|alarm|error code|fault code)/i;
const P4_WORDS = /(when you are next|next service|next visit|no rush|not urgent|minor|noisy|rattle|quote|quotation|price for)/i;

export function ruleTriage(textIn: string): z.infer<typeof TriageSchema> {
  const t = textIn;
  const quote = /(quote|quotation|price for|pricing|estimate|replace(ment)?|install(ation)?|new (unit|system))/i.test(t) && !P1_WORDS.test(t);
  const priority = P1_WORDS.test(t) ? 'P1' : P2_WORDS.test(t) ? 'P2' : P4_WORDS.test(t) ? 'P4' : 'P3';
  const skills = new Set<string>();
  if (/(air ?con|a\/c|\bac\b|split|cassette|cooling|daikin|mitsubishi|fujitsu|toshiba|lg |samsung)/i.test(t)) skills.add('ac');
  if (/(vrf|vrv|city multi)/i.test(t)) skills.add('vrf');
  if (/(cold ?room|freezer|fridge|refrigerat|display case|chiller cabinet)/i.test(t)) skills.add('refrigeration');
  if (/(boiler|heating|radiator|gas)/i.test(t)) skills.add('heating');
  if (/(ahu|air handling|ventilation|extract|mvhr|fan)/i.test(t)) skills.add('ventilation');
  if (/(heat pump|ashp)/i.test(t)) skills.add('heat_pumps');
  if (/(bms|controls|thermostat|controller)/i.test(t)) skills.add('controls');
  const postcode = t.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1] ?? null;
  const po = t.match(/\b(?:PO|P\.O\.|order|work order|WO)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null;
  const firstLine = t.split(/\n/).map((s) => s.trim()).find((s) => s.length > 10) ?? t.slice(0, 80);
  return {
    request_type: quote ? 'quote_request' : 'fault',
    summary: firstLine.slice(0, 90),
    fault_description: t.trim().slice(0, 2000),
    priority,
    priority_reason: priority === 'P1' ? 'Keywords suggest business-critical loss or risk to occupants/stock' : priority === 'P2' ? 'Keywords suggest loss of service' : priority === 'P4' ? 'Described as minor / non-urgent' : 'Routine fault',
    customer_name_mentioned: null,
    site_mentioned: postcode,
    contact_name: null,
    contact_phone: t.match(/(\+?44\s?7\d{3}|\(?07\d{3}\)?|\(?0\d{2,4}\)?)\s?\d{3}\s?\d{3,4}/)?.[0] ?? null,
    customer_ref: po,
    equipment_hints: [],
    required_skills: [...skills],
    access_constraints: null,
    suggested_reply: 'Thank you for contacting Frostline. We have logged your request and a member of our service team will be in touch shortly to confirm arrangements.',
  };
}

export async function triage(input: { text: string; from_email?: string | null; from_phone?: string | null; from_name?: string | null; customer_id?: number | null; site_id?: number | null }): Promise<Triage> {
  let result: z.infer<typeof TriageSchema>;
  let source: 'ai' | 'rules' = 'ai';
  if (aiConfigured()) {
    result = await structured(
      TriageSchema,
      `You triage incoming service requests for Frostline, a commercial HVAC contractor in North West England. Priorities: ${Object.entries(PRIORITIES)
        .map(([k, v]) => `${k}: ${v.description}`)
        .join('. ')}. Consider the building type (care homes, healthcare, server rooms, food retail cold chain and kitchens are higher risk) and weather-driven urgency. Skill codes: ${Object.keys(SKILLS).join(', ')}.`,
      `From: ${input.from_name ?? ''} <${input.from_email ?? input.from_phone ?? 'unknown'}>\n\n${input.text}`,
    );
  } else {
    result = ruleTriage(input.text);
    source = 'rules';
  }

  // Resolve candidates in our data
  const senderMatches = matchSender(input);
  const customerIds = new Set<number>(senderMatches.map((m) => m.customer_id));
  if (input.customer_id) customerIds.add(input.customer_id);
  let siteCandidates: Row[] = [];
  if (input.site_id) siteCandidates = crm.listSites({}).filter((s) => s.id === input.site_id);
  if (result.site_mentioned) siteCandidates.push(...crm.listSites({ search: result.site_mentioned }));
  if (!siteCandidates.length && result.site_mentioned) {
    for (const word of result.site_mentioned.split(/[,\s]+/).filter((w) => w.length > 3)) siteCandidates.push(...crm.listSites({ search: word }));
  }
  if (result.customer_name_mentioned) for (const c of crm.listCustomers({ search: result.customer_name_mentioned }).slice(0, 3)) customerIds.add(c.id);
  if (!siteCandidates.length) for (const cid of customerIds) siteCandidates.push(...crm.listSites({ customer_id: cid }));
  if (customerIds.size) {
    const inCustomer = siteCandidates.filter((s) => customerIds.has(s.customer_id));
    if (inCustomer.length) siteCandidates = inCustomer;
  }
  const uniqueSites = [...new Map(siteCandidates.map((s) => [s.id, s])).values()].slice(0, 8);
  let assetCandidates: Row[] = [];
  if (uniqueSites.length === 1) {
    const assets = crm.listAssets({ site_id: uniqueSites[0].id });
    const hints = result.equipment_hints.join(' ').toLowerCase();
    assetCandidates = assets
      .map((a) => ({ a, score: [a.tag, a.category, a.manufacturer, a.model, a.location].filter(Boolean).reduce((s, f) => s + (String(f).toLowerCase().split(/\W+/).some((w) => w.length > 2 && hints.includes(w)) ? 1 : 0), 0) }))
      .filter((x) => x.score > 0 || assets.length <= 3)
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)
      .map((x) => ({ id: x.a.id, tag: x.a.tag, category: x.a.category, manufacturer: x.a.manufacturer, model: x.a.model, location: x.a.location }));
  }
  return {
    ...result,
    source,
    customer_candidates: [...customerIds].map((id) => q.get<Row>('SELECT id, name, on_stop, po_required FROM customers WHERE id = ?', id)!).filter(Boolean),
    site_candidates: uniqueSites,
    asset_candidates: assetCandidates,
  };
}

// ─── Quote drafting ───────────────────────────────────────────────────────

const QuoteDraftSchema = z.object({
  title: z.string(),
  kind: z.enum(['repair', 'remedial', 'replacement', 'installation', 'other']),
  scope: z.string().describe('Customer-facing scope of works, plain paragraphs / bullet points'),
  exclusions: z.string(),
  assumptions: z.array(z.string()).describe('Internal notes for the estimator: assumptions made, things to check'),
  lines: z.array(
    z.object({
      kind: z.enum(['labour', 'materials', 'equipment', 'subcontract', 'access', 'other']),
      sku: z.string().nullable().describe('Catalogue SKU if the item is from the parts list provided, else null'),
      description: z.string(),
      qty: z.number(),
      unit_cost: z.number(),
      unit_price: z.number(),
    }),
  ),
});

export async function draftQuote(_actor: Actor, input: { job_id?: number; defect_ids?: number[]; site_id?: number; brief?: string }) {
  const rates = getSetting('rates', DEFAULT_RATES);
  let context = '';
  let siteId = input.site_id;
  if (input.job_id) {
    const job = jobs.getJob(input.job_id);
    siteId = job.site_id;
    context += `JOB ${job.job_no} (${job.kind}) at ${job.site_name}, ${job.customer_name}\nReported: ${job.title}\n${job.description ?? ''}\nContract: ${job.contract_ref ?? 'none'} ${job.contract_level ?? ''}\n`;
    context += `Engineer visits:\n${job.visits.map((v: Row) => `- ${v.engineer_name} ${v.starts_at.slice(0, 10)} outcome ${v.outcome ?? v.status}: ${v.work_summary ?? ''}`).join('\n')}\n`;
    context += `Notes:\n${job.notes.filter((n: Row) => n.kind !== 'system').map((n: Row) => `- ${n.body}`).join('\n')}\n`;
    context += `Equipment on job:\n${job.assets.map((a: Row) => `- ${a.tag} ${a.category} ${a.manufacturer ?? ''} ${a.model ?? ''} ${a.refrigerant ?? ''} ${a.refrigerant_kg ?? ''}kg installed ${a.install_date ?? '?'} location ${a.location ?? ''}`).join('\n')}\n`;
    context += `Defects raised:\n${job.defects.map((d: Row) => `- [${d.severity}] ${d.asset_tag ?? ''} ${d.description} → ${d.recommendation ?? ''}`).join('\n')}\n`;
  }
  if (input.defect_ids?.length) {
    const defects = q.all<Row>(`SELECT d.*, a.tag, a.category, a.manufacturer, a.model, a.refrigerant, a.refrigerant_kg, a.install_date, a.location FROM defects d LEFT JOIN assets a ON a.id = d.asset_id WHERE d.id IN (${input.defect_ids.map(() => '?').join(',')})`, ...input.defect_ids);
    siteId ??= defects[0]?.site_id;
    context += `Defects to quote:\n${defects.map((d) => `- [${d.severity}] ${d.tag ?? ''} ${d.category ?? ''} ${d.manufacturer ?? ''} ${d.model ?? ''} (${d.refrigerant ?? ''} ${d.refrigerant_kg ?? ''}kg, installed ${d.install_date ?? '?'}, ${d.location ?? ''}): ${d.description} → ${d.recommendation ?? ''}`).join('\n')}\n`;
  }
  if (siteId) {
    const site = crm.getSite(siteId);
    context += `SITE ${site.name}, ${site.address ?? ''} ${site.postcode ?? ''}. Building: ${site.building_type ?? ''}. Access: ${site.access_notes ?? ''}. Hazards: ${site.hazards ?? ''}. Hours: ${site.opening_hours ?? ''}\n`;
  }
  if (input.brief) context += `ESTIMATOR BRIEF: ${input.brief}\n`;
  if (!context) throw badRequest('Provide a job, defects or a brief');

  const parts = listParts({}).map((p: Row) => `${p.sku} | ${p.name} | cost £${p.unit_cost} | sell £${p.sell_price}`).join('\n');
  const draft = await structured(
    QuoteDraftSchema,
    `You are an experienced HVAC estimator at Frostline (commercial HVAC contractor, Greater Manchester). Draft realistic quotes in GBP excluding VAT.
Rate card: labour £${rates.labour_normal}/hr normal hours (engineer cost ~£28/hr), overtime £${rates.labour_overtime}/hr, materials markup ${rates.materials_markup_pct}% on cost. Two engineers are needed for heavy lifts, roof work or VRF/condensing unit swaps. Include travel time, refrigerant recovery/disposal and waste where relevant, access equipment (e.g. tower/MEWP hire) if work is at height, commissioning. For equipment not in the catalogue, estimate a sensible trade cost and mark it in assumptions. Use catalogue SKUs exactly when used.
Parts catalogue:\n${parts}`,
    context,
    'medium',
  );
  const lines = draft.lines.map((l) => {
    const part = l.sku ? q.get<Row>('SELECT id, unit_cost, sell_price FROM parts WHERE sku = ?', l.sku) : undefined;
    return { kind: l.kind, part_id: part?.id ?? null, description: l.description, qty: l.qty, unit_cost: part?.unit_cost ?? l.unit_cost, unit_price: part?.sell_price ?? l.unit_price };
  });
  return { ...draft, lines, site_id: siteId ?? null };
}

// ─── Briefings, notes and customer updates ────────────────────────────────

export async function siteBriefing(siteId: number, jobId?: number) {
  const site = crm.getSite(siteId);
  const job = jobId ? jobs.getJob(jobId) : null;
  const history = q.all<Row>(
    `SELECT j.job_no, j.kind, j.title, j.completed_at, j.cause, j.resolution, (SELECT GROUP_CONCAT(v.work_summary, ' | ') FROM visits v WHERE v.job_id = j.id) AS work
     FROM jobs j WHERE j.site_id = ? AND j.status IN ('completed','closed') ORDER BY j.completed_at DESC LIMIT 15`,
    siteId,
  );
  return text(
    'You brief HVAC engineers before they attend a commercial site. Write a short, scannable briefing (max ~180 words, markdown bullets): access/safety first, then relevant equipment and its recent history, recurring problems, open defects, and anything to take (parts, ladders, induction). Only use the data given.',
    JSON.stringify(compact({ site: { ...site, jobs: undefined }, job: job && { job_no: job.job_no, title: job.title, description: job.description, assets: job.assets, priority: job.priority }, recent_history: history })),
  );
}

export async function tidyWorkNotes(raw: string, context?: string) {
  return text(
    'Rewrite an HVAC engineer’s rough site notes into a clear, professional service report paragraph for the customer record. Keep every technical fact, reading, part and recommendation. Do not invent anything. UK English. Return only the rewritten text.',
    `${context ? `Context: ${context}\n\n` : ''}Notes:\n${raw}`,
  );
}

export async function customerUpdate(jobId: number, tone: 'email' | 'sms' = 'email') {
  const job = jobs.getJob(jobId);
  return text(
    `Draft a ${tone === 'sms' ? 'short SMS (max 300 characters)' : 'concise email (subject line then body)'} from Frostline's service desk updating the customer on their job. Be factual and helpful; state next steps and dates if known; no internal notes, costs or engineer phone numbers. UK English. Sign off as "Frostline Service Desk".`,
    JSON.stringify(compact({ job_no: job.job_no, customer_ref: job.customer_ref, site: job.site_name, title: job.title, status: job.status, hold_reason: job.hold_reason, reported_by: job.reported_by, visits: job.visits.map((v: Row) => ({ engineer: v.engineer_name.split(' ')[0], starts_at: v.starts_at, status: v.status, outcome: v.outcome, work_summary: v.work_summary })), notes: job.notes.filter((n: Row) => n.kind !== 'system').slice(0, 5).map((n: Row) => n.body), pos: job.purchase_orders, quotes: job.quotes })),
  );
}
