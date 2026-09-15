import Anthropic from '@anthropic-ai/sdk';
import { q, insert, update, parseJson, type Row } from '../db/index.ts';
import { HttpError, type Actor } from '../lib/context.ts';
import { AI_EFFORT, AI_MODEL, AiUnavailableError, FALLBACK_BETA, aiConfigured, anthropic, describeAiError } from './client.ts';
import { runTool, toolDefinitions, toolIsWrite, type ToolLink } from './tools.ts';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

const SYSTEM_PROMPT = `You are the operations assistant built into FrostLine Ops, the operations system for Frostline Mechanical Services Ltd — an independent commercial HVAC contractor (air conditioning, heating, ventilation, refrigeration, heat pumps, controls) based in Bury, Greater Manchester, working across Greater Manchester, Lancashire, Merseyside, Cheshire and West Yorkshire for offices, retail, hospitality, education, healthcare/care homes, light industrial and multi-site/FM customers.

You act on the live system through tools. Staff use you to do things that would otherwise take several screens: find customers/sites/equipment, log jobs, work out who can attend, book and move visits, chase SLA risks, draft quotes, check stock and raise POs, and answer questions about history, contracts and compliance.

How to work:
- Look things up rather than guessing. Resolve names/postcodes with the search tool, then fetch the record. Never invent IDs, prices, part numbers or history.
- If a search gives several plausible matches (e.g. a customer with multiple sites) and the request doesn't make it clear, ask a short clarifying question listing the options.
- Logging a job: identify the site and, where possible, the affected equipment (get_site lists it). Choose priority from the fault and the site context — e.g. total heating loss at a care home, a failed server/comms room cooling unit or a cold room/refrigeration failure with stock at risk is P1; partial loss or single unit in a critical area P2; single comfort unit P3. State the priority you chose and why. Relay every warning create_job returns (account on stop, PO required, induction/DBS, no contract).
- Scheduling: call suggest_engineers, then book the best option unless the user asked to choose. Say who, when, travel and whether the SLA is met. If nobody can meet the SLA say so plainly and offer the best alternatives (e.g. force a booking, subcontractor, move a lower-priority visit).
- Changes that are hard to undo — cancelling jobs or visits, accepting/declining quotes, generating PPM jobs in bulk, placing orders with suppliers, double-booking with force — need explicit confirmation from the user in this conversation first. Creating jobs, drafting quotes, booking a visit into a free slot and adding notes do not need confirmation when the user has asked for them.
- Quotes: use the rate card and parts catalogue; include labour (with travel), materials, access equipment where needed; write a clear customer-facing scope. Quotes are created as drafts for a human to review and send.
- Contract cover matters: PPM-only contracts do not cover reactive labour; comprehensive contracts may include parts up to a limit; out-of-hours attendance is only guaranteed where the contract has OOH cover.
- Refrigerant: R22 cannot be topped up; F-Gas leak-check frequency depends on CO2e charge. Only F-Gas certified engineers may work on refrigerant circuits.

Replies:
- Be brief and practical, UK English, like an experienced service coordinator. Lead with the outcome.
- Refer to records with markdown links so users can click through: jobs [J-00012](/jobs/12), customers [Name](/customers/3), sites [Site](/sites/7), equipment [TAG](/assets/9), quotes [Q-00004](/quotes/4), contracts [MC-0002](/contracts/2), purchase orders [PO-00003](/stock/purchase-orders/3), engineers [Name](/engineers/5). The number in the path is the record id, not the reference.
- Show times in UK local time (e.g. "Wed 16 Sep, 09:30"). Use short bullet lists or a compact table when listing several items.`;

export interface ChatEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'error' | 'conversation';
  [k: string]: unknown;
}

export interface PageContext {
  path?: string;
  entity?: { type: string; id: number; label?: string };
}

const MAX_TURNS = 16;

export function listConversations(actor: Actor) {
  return q.all('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30', actor.userId);
}

export function getConversation(actor: Actor, id: number) {
  const row = q.get<Row>('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?', id, actor.userId);
  if (!row) throw new HttpError(404, 'Conversation not found');
  return { ...row, messages: displayMessages(parseJson<MessageParam[]>(row.messages, [])) };
}

/** Reduce raw API history to what the chat UI shows: user text, assistant text and tool activity. */
function displayMessages(messages: MessageParam[]) {
  const out: { role: 'user' | 'assistant'; text: string; tools?: string[]; links?: ToolLink[] }[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content === 'string') {
      out.push({ role: m.role, text: stripContext(m.content) });
      continue;
    }
    if (m.role === 'user') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      if (text) out.push({ role: 'user', text: stripContext(text) });
      continue;
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
    const tools = m.content.filter((b) => b.type === 'tool_use').map((b) => (b as { name: string }).name);
    const last = out[out.length - 1];
    if (last?.role === 'assistant') {
      last.text = [last.text, text].filter(Boolean).join('\n\n');
      last.tools = [...(last.tools ?? []), ...tools];
    } else out.push({ role: 'assistant', text, tools });
  }
  return out;
}

const stripContext = (s: string) => s.replace(/<context>[\s\S]*?<\/context>\s*/g, '');

function contextBlock(actor: Actor, page?: PageContext) {
  const now = new Date();
  const lines = [
    `Now: ${now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (UK), ISO ${now.toISOString()}`,
    `User: ${actor.name} (role: ${actor.role}${actor.engineerId ? `, engineer id ${actor.engineerId}` : ''})`,
  ];
  if (page?.path) lines.push(`User is viewing: ${page.path}${page.entity ? ` — ${page.entity.type} id ${page.entity.id}${page.entity.label ? ` (${page.entity.label})` : ''}` : ''}`);
  return `<context>\n${lines.join('\n')}\n</context>\n`;
}

/**
 * Run one user turn of the assistant: stream text back, execute tool calls against the service layer (as the
 * signed-in user, so permissions apply) and persist the whole exchange.
 */
export async function chat(actor: Actor, body: { conversation_id?: number; message: string; page?: PageContext }, emit: (e: ChatEvent) => void) {
  if (!aiConfigured()) throw new AiUnavailableError();
  let convo = body.conversation_id ? q.get<Row>('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?', body.conversation_id, actor.userId) : undefined;
  if (!convo) {
    const id = insert('ai_conversations', { user_id: actor.userId, title: body.message.slice(0, 80), messages: '[]' });
    convo = q.get<Row>('SELECT * FROM ai_conversations WHERE id = ?', id)!;
  }
  emit({ type: 'conversation', id: convo.id });

  const messages = parseJson<MessageParam[]>(convo.messages, []);
  messages.push({ role: 'user', content: contextBlock(actor, body.page) + body.message });
  const tools = toolDefinitions(actor);
  const links: ToolLink[] = [];
  const client = anthropic();
  const save = () => update('ai_conversations', convo!.id, { messages: JSON.stringify(messages), updated_at: new Date().toISOString() });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.beta.messages.stream({
        model: AI_MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: AI_EFFORT },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
      stream.on('text', (delta) => emit({ type: 'text', delta }));
      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        emit({ type: 'text', delta: '\n\nSorry — I can’t help with that request.' });
        break;
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        emit({ type: 'error', message: 'The response was cut off before a tool call finished. Please try a narrower request.' });
        break;
      }
      messages.push({ role: 'assistant', content: message.content });
      if (!toolUses.length) break;

      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        emit({ type: 'tool_start', id: tu.id, name: tu.name, writes: toolIsWrite(tu.name) });
        const before = links.length;
        try {
          const result = runTool(actor, tu.name, tu.input, links);
          const isError = Boolean(result && typeof result === 'object' && 'error' in result);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result), is_error: isError || undefined });
          emit({ type: 'tool_end', id: tu.id, name: tu.name, ok: !isError, links: links.slice(before) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true });
          emit({ type: 'tool_end', id: tu.id, name: tu.name, ok: false, error: msg });
        }
      }
      messages.push({ role: 'user', content: results });
      save();
    }
    save();
    emit({ type: 'done', conversation_id: convo.id, links: dedupeLinks(links) });
  } catch (err) {
    // Keep history consistent: drop a trailing assistant tool_use turn with no results.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) messages.pop();
    if (messages[messages.length - 1]?.role === 'user' && typeof messages[messages.length - 1].content === 'string') messages.pop();
    save();
    emit({ type: 'error', message: describeAiError(err) });
  }
}

function dedupeLinks(links: ToolLink[]) {
  const seen = new Map<string, ToolLink>();
  for (const l of links) {
    const key = `${l.type}:${l.id}`;
    const prev = seen.get(key);
    // prefer the most significant action for a record
    const rank = { created: 3, scheduled: 2, updated: 1, viewed: 0 } as const;
    if (!prev || rank[l.action ?? 'viewed'] >= rank[prev.action ?? 'viewed']) seen.set(key, l);
  }
  return [...seen.values()].filter((l) => l.action !== 'viewed');
}
