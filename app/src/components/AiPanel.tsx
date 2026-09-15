import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUp, Check, History, Loader2, Plus, Sparkles, Wrench, X, AlertCircle } from 'lucide-react';
import { api, queryClient } from '../lib/api';
import { useMeta } from '../lib/auth';
import { Markdown } from './domain';
import { cx } from './ui';

interface ToolStep {
  id: string;
  name: string;
  ok?: boolean;
  error?: string;
  writes?: boolean;
}
interface ChatLink {
  type: string;
  id: number;
  label: string;
  action?: string;
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  steps?: ToolStep[];
  links?: ChatLink[];
  error?: string;
  pending?: boolean;
}

interface PageEntity {
  type: string;
  id: number;
  label?: string;
}

interface AiCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  ask: (text: string) => void;
  setEntity: (e: PageEntity | null) => void;
}
const Ctx = createContext<AiCtx>(null as any);
export const useAi = () => useContext(Ctx);

/** Tell the assistant which record the user is looking at. */
export function useAiEntity(entity: PageEntity | null) {
  const { setEntity } = useAi();
  useEffect(() => {
    setEntity(entity);
    return () => setEntity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.type, entity?.id, entity?.label]);
}

const TOOL_LABEL: Record<string, string> = {
  search: 'Searching records',
  get_customer: 'Reading customer',
  get_site: 'Reading site & equipment',
  get_asset: 'Reading equipment history',
  find_jobs: 'Finding jobs',
  get_job: 'Reading job',
  create_job: 'Logging job',
  update_job: 'Updating job',
  add_job_note: 'Adding note',
  list_engineers: 'Checking engineers',
  suggest_engineers: 'Working out who can attend',
  engineer_availability: 'Checking availability',
  get_schedule: 'Reading schedule',
  schedule_visit: 'Booking visit',
  reschedule_visit: 'Moving visit',
  cancel_visit: 'Cancelling visit',
  find_quotes: 'Finding quotes',
  get_quote: 'Reading quote',
  get_rate_card: 'Checking rates',
  create_quote: 'Drafting quote',
  update_quote: 'Updating quote',
  set_quote_status: 'Updating quote status',
  convert_quote_to_job: 'Creating job from quote',
  search_parts: 'Checking parts & stock',
  low_stock: 'Checking low stock',
  create_purchase_order: 'Raising purchase order',
  list_suppliers: 'Checking suppliers',
  find_contracts: 'Finding contracts',
  get_contract: 'Reading contract',
  ppm_due: 'Checking planned maintenance',
  generate_ppm_jobs: 'Generating PPM jobs',
  list_enquiries: 'Reading inbox',
  get_enquiry: 'Reading enquiry',
  update_enquiry: 'Updating enquiry',
  log_activity: 'Logging activity',
  operations_summary: 'Reviewing operations',
  kpi_report: 'Calculating KPIs',
  compliance_report: 'Checking compliance',
};

const LINK_PATH: Record<string, string> = { job: 'jobs', customer: 'customers', site: 'sites', asset: 'assets', quote: 'quotes', contract: 'contracts', purchase_order: 'stock/purchase-orders', enquiry: 'inbox', engineer: 'engineers', part: 'stock/parts' };

const SUGGESTIONS = [
  'What needs attention right now?',
  'Oakfield Lodge have no heating in the east wing — log it and get someone there',
  'Who is free tomorrow afternoon for a refrigeration job in Bury?',
  'Draft a quote to replace the R22 server room unit at Harlow House',
  'Which F-Gas leak checks are overdue?',
];

export function AiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => localStorage.getItem('fl.ai.open') === '1');
  const [entity, setEntity] = useState<PageEntity | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  useEffect(() => localStorage.setItem('fl.ai.open', open ? '1' : '0'), [open]);
  const ask = useCallback((text: string) => {
    setOpen(true);
    setQueued(text);
  }, []);
  return (
    <Ctx.Provider value={{ open, setOpen, ask, setEntity }}>
      {children}
      <AiPanelInner open={open} onClose={() => setOpen(false)} entity={entity} queued={queued} clearQueued={() => setQueued(null)} />
    </Ctx.Provider>
  );
}

function AiPanelInner({ open, onClose, entity, queued, clearQueued }: { open: boolean; onClose: () => void; entity: PageEntity | null; queued: string | null; clearQueued: () => void }) {
  const meta = useMeta();
  const location = useLocation();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setInput('');
      setBusy(true);
      setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '', steps: [], pending: true }]);
      const update = (fn: (m: Msg) => Msg) => setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, conversation_id: conversationId ?? undefined, page: { path: location.pathname, entity: entity ?? undefined } }),
        });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.replace(/^data: /, '');
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.type === 'conversation') setConversationId(ev.id);
            else if (ev.type === 'text') update((m) => ({ ...m, text: m.text + ev.delta }));
            else if (ev.type === 'tool_start') {
              update((m) => ({ ...m, text: m.text && !m.text.endsWith('\n\n') ? m.text + '\n\n' : m.text, steps: [...(m.steps ?? []), { id: ev.id, name: ev.name, writes: ev.writes }] }));
            } else if (ev.type === 'tool_end') {
              update((m) => ({ ...m, steps: m.steps?.map((s) => (s.id === ev.id ? { ...s, ok: ev.ok, error: ev.error } : s)) }));
              if (ev.ok && ev.links?.some((l: ChatLink) => l.action && l.action !== 'viewed')) queryClient.invalidateQueries();
            } else if (ev.type === 'done') update((m) => ({ ...m, pending: false, links: ev.links }));
            else if (ev.type === 'error') update((m) => ({ ...m, pending: false, error: ev.message }));
          }
        }
      } catch (err) {
        update((m) => ({ ...m, pending: false, error: err instanceof Error ? err.message : 'Request failed' }));
      } finally {
        update((m) => ({ ...m, pending: false }));
        setBusy(false);
      }
    },
    [busy, conversationId, entity, location.pathname],
  );

  useEffect(() => {
    if (queued && !busy) {
      send(queued);
      clearQueued();
    }
  }, [queued, busy, send, clearQueued]);

  const newChat = () => {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  };
  const loadHistory = async () => {
    setShowHistory((v) => !v);
    setHistory(await api('/ai/conversations'));
  };
  const openConversation = async (id: number) => {
    const c = await api(`/ai/conversations/${id}`);
    setConversationId(id);
    setMessages(c.messages.map((m: any) => ({ role: m.role, text: m.text, steps: (m.tools ?? []).map((t: string, i: number) => ({ id: String(i), name: t, ok: true })) })));
    setShowHistory(false);
  };

  return (
    <aside
      className={cx(
        'fixed top-0 right-0 bottom-0 z-40 flex w-full flex-col border-l border-line bg-white shadow-2xl transition-transform duration-200 sm:w-[420px]',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      aria-hidden={!open}
      aria-label="Frostline assistant"
    >
      <header className="flex items-center gap-2 border-b border-line bg-navy-800 px-4 py-3 text-white">
        <Sparkles className="size-4 text-steel-100" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Ask Frostline</div>
          <div className="text-xs text-steel-100/80">{entity ? `Looking at ${entity.label ?? entity.type}` : 'Operations assistant'}</div>
        </div>
        <button onClick={loadHistory} className="rounded p-1.5 hover:bg-navy-700" title="Previous conversations">
          <History className="size-4" />
        </button>
        <button onClick={newChat} className="rounded p-1.5 hover:bg-navy-700" title="New conversation">
          <Plus className="size-4" />
        </button>
        <button onClick={onClose} className="rounded p-1.5 hover:bg-navy-700" title="Close">
          <X className="size-4" />
        </button>
      </header>

      {showHistory && (
        <div className="max-h-64 overflow-y-auto border-b border-line bg-paper">
          {history.length === 0 && <div className="p-4 text-sm text-muted">No previous conversations.</div>}
          {history.map((h) => (
            <button key={h.id} onClick={() => openConversation(h.id)} className="block w-full truncate border-b border-line px-4 py-2 text-left text-sm hover:bg-white">
              {h.title}
            </button>
          ))}
        </div>
      )}

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {meta && !meta.ai?.configured && (
          <div className="rounded-md border border-warm/40 bg-warn-50 p-3 text-sm text-[#7a4b0c]">
            The assistant needs an Anthropic API key. Add <code className="rounded bg-white px-1">ANTHROPIC_API_KEY=…</code> to <code className="rounded bg-white px-1">app/.env</code> and restart the server. Everything else in FrostLine Ops works without it.
          </div>
        )}
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-muted">Ask in plain English. The assistant can find records, log jobs, work out who can attend, book visits, draft quotes and check stock — and it tells you what it changed.</p>
            <div className="mt-4 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="block w-full rounded-md border border-line px-3 py-2 text-left text-sm text-ink hover:border-steel-500 hover:bg-steel-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-8 rounded-lg bg-steel-50 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
              {m.text}
            </div>
          ) : (
            <div key={i} className="text-sm text-ink">
              {!!m.steps?.length && (
                <ul className="mb-2 space-y-1">
                  {m.steps.map((s) => (
                    <li key={s.id} className={cx('flex items-center gap-1.5 text-xs', s.ok === false ? 'text-scald' : 'text-muted')}>
                      {s.ok === undefined ? <Loader2 className="size-3 animate-spin" /> : s.ok ? s.writes ? <Check className="size-3 text-ok" /> : <Wrench className="size-3" /> : <AlertCircle className="size-3" />}
                      <span className={cx(s.writes && s.ok && 'font-medium text-ok')}>{TOOL_LABEL[s.name] ?? s.name}</span>
                      {s.error && <span className="truncate">— {s.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {m.text && <Markdown text={m.text} />}
              {m.pending && !m.text && !m.steps?.length && <Loader2 className="size-4 animate-spin text-muted" />}
              {m.error && <div className="mt-2 rounded border border-scald/30 bg-scald-50 px-2 py-1.5 text-xs text-scald">{m.error}</div>}
              {!!m.links?.length && (
                <div className="mt-2 rounded-md border border-ok/25 bg-ok-50 p-2">
                  <div className="mb-1 text-xs font-medium text-ok">Changes made</div>
                  {m.links.map((l) => (
                    <Link key={`${l.type}${l.id}`} to={`/${LINK_PATH[l.type]}/${l.id}`} className="block truncate text-xs text-navy-800 hover:underline">
                      {titleAction(l.action)} {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-white p-1.5 focus-within:border-steel-500">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="e.g. Book Sam onto J-00123 tomorrow morning"
            className="max-h-40 flex-1 resize-none px-1.5 py-1 text-sm focus:outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} className="rounded-md bg-steel-600 p-2 text-white disabled:opacity-40" aria-label="Send">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </form>
    </aside>
  );
}

const titleAction = (a?: string) => (a === 'created' ? 'Created' : a === 'scheduled' ? 'Booked' : 'Updated');
