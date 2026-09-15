import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Printer, Plus, Sparkles, Trash2 } from 'lucide-react';
import { errorText, patch, post, queryClient, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { useAiEntity } from '../components/AiPanel';
import { Badge, Button, ErrorNote, Field, Input, KV, Modal, PageHeader, Panel, Select, Spinner, Textarea, cx } from '../components/ui';
import { EntityLink, QuoteStatus } from '../components/domain';
import { date, dateTime, money2, titleCase } from '../lib/format';

const KINDS = ['labour', 'materials', 'equipment', 'subcontract', 'access', 'other'];

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const p = perms(user);
  const { data: q, isLoading } = useApi<any>(`/quotes/${id}`);
  const [lines, setLines] = useState<any[]>([]);
  const [fields, setFields] = useState({ title: '', scope: '', exclusions: '' });
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [brief, setBrief] = useState('');
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [modal, setModal] = useState<null | 'accept' | 'decline' | 'convert'>(null);
  const [partSearch, setPartSearch] = useState('');
  const parts = useApi<any[]>(partSearch.length >= 2 ? `/parts?search=${encodeURIComponent(partSearch)}` : null);
  useAiEntity(q ? { type: 'quote', id: q.id, label: `${q.quote_no} ${q.title}` } : null);

  useEffect(() => {
    if (q && !dirty) {
      setLines(q.lines.map((l: any) => ({ ...l })));
      setFields({ title: q.title, scope: q.scope ?? '', exclusions: q.exclusions ?? '' });
    }
  }, [q, dirty]);

  if (isLoading || !q) return <Spinner />;
  const editable = ['draft', 'sent'].includes(q.status) && p.quotes;
  const net = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0), 0);
  const cost = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_cost || 0), 0);
  const setLine = (i: number, k: string, v: any) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await patch(`/quotes/${q.id}`, { ...fields, lines: lines.map((l) => ({ kind: l.kind, part_id: l.part_id ?? null, description: l.description, qty: Number(l.qty), unit_cost: Number(l.unit_cost) || 0, unit_price: Number(l.unit_price) || 0 })) });
      setDirty(false);
      queryClient.invalidateQueries();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const aiDraft = async () => {
    setDrafting(true);
    setErr(null);
    try {
      const d = await post('/ai/draft-quote', { job_id: q.source_job_id ?? undefined, defect_ids: q.defects.map((x: any) => x.id), site_id: q.site_id ?? undefined, brief: [q.title, fields.scope, brief].filter(Boolean).join('\n') });
      setLines(d.lines);
      setFields({ title: fields.title || d.title, scope: d.scope, exclusions: d.exclusions || fields.exclusions });
      setAssumptions(d.assumptions ?? []);
      setDirty(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setDrafting(false);
    }
  };

  const status = async (s: string, extra: any = {}) => {
    setErr(null);
    try {
      if (dirty) await save();
      await post(`/quotes/${q.id}/status`, { status: s, ...extra });
      queryClient.invalidateQueries();
      setModal(null);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="mb-1 text-sm">
        <EntityLink to={`/customers/${q.customer_id}`}>{q.customer_name}</EntityLink>
        {q.site_id && <> / <EntityLink to={`/sites/${q.site_id}`}>{q.site_name}</EntityLink></>}
      </div>
      <PageHeader
        title={<><span className="num text-muted">{q.quote_no}</span> {q.title}</>}
        actions={
          <>
            <Link to={`/quotes/${q.id}/print`} target="_blank"><Button icon={<Printer className="size-4" />}>Print / PDF</Button></Link>
            {editable && dirty && <Button variant="primary" loading={saving} onClick={save}>Save changes</Button>}
            {q.status === 'draft' && p.quotes && <Button variant="navy" onClick={() => status('sent')}>Mark as sent</Button>}
            {['sent', 'expired'].includes(q.status) && p.quotes && (
              <>
                <Button onClick={() => setModal('decline')}>Declined</Button>
                <Button variant="primary" onClick={() => setModal('accept')}>Accepted</Button>
              </>
            )}
            {q.status === 'accepted' && !q.converted_job_id && p.quotes && <Button variant="primary" onClick={() => setModal('convert')}>Create job</Button>}
            {q.converted_job_id && <Link to={`/jobs/${q.converted_job_id}`}><Button>Job {q.converted_job_no}</Button></Link>}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap gap-2">
          <QuoteStatus s={q.status} />
          <Badge>{titleCase(q.kind)}</Badge>
          {q.source_job_no && <Link to={`/jobs/${q.source_job_id}`}><Badge tone="blue">From {q.source_job_no}</Badge></Link>}
          {q.valid_until && <span className="text-xs text-muted">Valid until {date(q.valid_until)}</span>}
        </div>
      </PageHeader>
      <ErrorNote error={err} />

      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Panel title="Scope">
            <div className="space-y-3">
              <Field label="Title"><Input disabled={!editable} value={fields.title} onChange={(e) => { setFields({ ...fields, title: e.target.value }); setDirty(true); }} /></Field>
              <Field label="Scope of works (customer-facing)"><Textarea disabled={!editable} rows={5} value={fields.scope} onChange={(e) => { setFields({ ...fields, scope: e.target.value }); setDirty(true); }} /></Field>
              <Field label="Exclusions"><Textarea disabled={!editable} rows={2} value={fields.exclusions} onChange={(e) => { setFields({ ...fields, exclusions: e.target.value }); setDirty(true); }} /></Field>
            </div>
          </Panel>

          {editable && (
            <Panel title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-steel-600" /> Draft with AI</span>}>
              <p className="mb-2 text-sm text-muted">Uses the {q.source_job_no ? `engineer's findings on ${q.source_job_no}, ` : ''}{q.defects.length ? 'linked defects, ' : ''}site equipment, the parts catalogue and your rate card. Replaces the lines below — review before sending.</p>
              <div className="flex gap-2">
                <Input placeholder="Anything to add? e.g. two engineers, Saturday working, include MEWP" value={brief} onChange={(e) => setBrief(e.target.value)} />
                <Button variant="primary" loading={drafting} onClick={aiDraft}>Draft lines</Button>
              </div>
              {assumptions.length > 0 && (
                <div className="mt-3 rounded-md border border-warm/40 bg-warn-50 p-3 text-sm">
                  <div className="mb-1 font-medium text-[#7a4b0c]">Check these assumptions</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-[#7a4b0c]">{assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Pricing" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit cost</th>
                    <th className="px-3 py-2 text-right">Unit price</th>
                    <th className="px-3 py-2 text-right">Line total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const lineMargin = l.unit_price ? (1 - l.unit_cost / l.unit_price) * 100 : 0;
                    return (
                      <tr key={i} className="border-b border-line/60 align-top">
                        <td className="px-3 py-1.5">
                          <select disabled={!editable} value={l.kind} onChange={(e) => setLine(i, 'kind', e.target.value)} className="rounded border border-transparent bg-transparent py-1 text-xs hover:border-line disabled:hover:border-transparent">
                            {KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input disabled={!editable} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} className="w-full min-w-[240px] rounded border border-transparent px-1 py-1 hover:border-line focus:border-steel-500 focus:outline-none disabled:bg-transparent" />
                          {l.sku && <div className="num px-1 text-xs text-muted">{l.sku}</div>}
                        </td>
                        {(['qty', 'unit_cost', 'unit_price'] as const).map((k) => (
                          <td key={k} className="px-3 py-1.5 text-right">
                            <input disabled={!editable} type="number" step="any" value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} className="num w-20 rounded border border-transparent px-1 py-1 text-right hover:border-line focus:border-steel-500 focus:outline-none disabled:bg-transparent" />
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right">
                          <div className="num py-1">{money2(Number(l.qty) * Number(l.unit_price))}</div>
                          <div className={cx('num text-xs', lineMargin < 20 ? 'text-hot' : 'text-muted')}>{Math.round(lineMargin)}%</div>
                        </td>
                        <td className="px-2 py-1.5">{editable && <button onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); }} className="p-1 text-muted hover:text-scald" aria-label="Remove line"><Trash2 className="size-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => { setLines([...lines, { kind: 'labour', description: 'Engineer labour', qty: 1, unit_cost: 28, unit_price: 68 }]); setDirty(true); }}>Labour</Button>
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => { setLines([...lines, { kind: 'other', description: '', qty: 1, unit_cost: 0, unit_price: 0 }]); setDirty(true); }}>Line</Button>
                <div className="relative">
                  <Input placeholder="Add catalogue part…" value={partSearch} onChange={(e) => setPartSearch(e.target.value)} className="h-7 w-64 text-xs" />
                  {parts.data && parts.data.length > 0 && (
                    <ul className="absolute bottom-8 z-10 max-h-56 w-80 overflow-y-auto rounded-md border border-line bg-white shadow-lg">
                      {parts.data.slice(0, 10).map((pt) => (
                        <li key={pt.id}>
                          <button className="block w-full px-3 py-1.5 text-left text-xs hover:bg-steel-50" onClick={() => { setLines([...lines, { kind: 'materials', part_id: pt.id, sku: pt.sku, description: pt.name, qty: 1, unit_cost: pt.unit_cost, unit_price: pt.sell_price }]); setPartSearch(''); setDirty(true); }}>
                            {pt.name} <span className="num text-muted">{money2(pt.sell_price)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Totals">
            <div className="space-y-1.5 text-sm">
              <Row label="Net" value={money2(net)} strong />
              <Row label="VAT 20%" value={money2(net * 0.2)} />
              <Row label="Total" value={money2(net * 1.2)} />
              <div className="my-2 border-t border-line" />
              <Row label="Cost" value={money2(cost)} />
              <Row label="Margin" value={`${money2(net - cost)} (${net ? Math.round(((net - cost) / net) * 100) : 0}%)`} tone={net && (net - cost) / net < 0.25 ? 'text-hot' : 'text-ok'} />
            </div>
          </Panel>
          <Panel title="Details">
            <KV cols={1} items={[
              ['Contact', q.contact_name ? `${q.contact_name} ${q.contact_email ? `<${q.contact_email}>` : ''}` : '—'],
              ['Prepared by', q.prepared_by_name],
              ['Created', date(q.created_at)],
              ['Sent', q.sent_at ? date(q.sent_at) : undefined],
              ['Follow up', q.follow_up_on ? date(q.follow_up_on) : undefined],
              ['Decision', q.decided_at ? `${date(q.decided_at)}${q.decline_reason ? ` — ${q.decline_reason}` : ''}` : undefined],
              ['Customer PO', q.customer_po ?? undefined],
            ]} />
          </Panel>
          {q.defects.length > 0 && (
            <Panel title="Defects covered">
              {q.defects.map((d: any) => <div key={d.id} className="py-1 text-sm"><Badge tone="amber">{titleCase(d.severity)}</Badge> {d.asset_tag} — {d.description}</div>)}
            </Panel>
          )}
          <Panel title="History">
            {q.history.map((h: any) => <div key={h.id} className="py-0.5 text-xs text-muted"><span className="num">{dateTime(h.created_at)}</span> {h.user_name}: {titleCase(h.action.replace('status_', ''))} {h.detail}</div>)}
          </Panel>
        </aside>
      </div>

      <AcceptModal open={modal === 'accept'} onClose={() => setModal(null)} onSave={(po: string) => status('accepted', { customer_po: po || undefined })} />
      <DeclineModal open={modal === 'decline'} onClose={() => setModal(null)} onSave={(r: string) => status('declined', { decline_reason: r })} />
      <ConvertModal open={modal === 'convert'} onClose={() => setModal(null)} quote={q} onDone={(jobId: number) => navigate(`/jobs/${jobId}`)} />
    </div>
  );
}

const Row = ({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) => (
  <div className="flex justify-between"><span className="text-muted">{label}</span><span className={cx('num', strong && 'font-semibold text-navy-900', tone)}>{value}</span></div>
);

function AcceptModal({ open, onClose, onSave }: any) {
  const [po, setPo] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Quote accepted" footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" onClick={() => onSave(po)}>Mark accepted</Button></>}>
      <Field label="Customer order / PO number" hint="Carried onto the job for invoicing"><Input value={po} onChange={(e) => setPo(e.target.value)} /></Field>
    </Modal>
  );
}

function DeclineModal({ open, onClose, onSave }: any) {
  const [r, setR] = useState('Price');
  const [other, setOther] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Quote declined" footer={<><Button onClick={onClose}>Back</Button><Button variant="danger" onClick={() => onSave(r === 'Other' ? other : `${r}${other ? ` — ${other}` : ''}`)}>Mark declined</Button></>}>
      <div className="space-y-3">
        <Field label="Reason">
          <Select value={r} onChange={(e) => setR(e.target.value)}>
            {['Price', 'Budget — deferred', 'Went with another contractor', 'No longer required', 'Customer did the work themselves', 'Other'].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Input value={other} onChange={(e) => setOther(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ConvertModal({ open, onClose, quote, onDone }: any) {
  const labour = quote.lines.filter((l: any) => l.kind === 'labour').reduce((s: number, l: any) => s + l.qty, 0);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState(String(labour || 4));
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const go = async () => {
    try {
      const r = await post(`/quotes/${quote.id}/convert`, { target_start_on: start, est_hours: Number(hours) });
      queryClient.invalidateQueries();
      if (r.materials_to_order.length) setResult(r);
      else onDone(r.job.id);
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Create job from quote" footer={result ? <Button variant="primary" onClick={() => onDone(result.job.id)}>Open {result.job.job_no}</Button> : <><Button onClick={onClose}>Back</Button><Button variant="primary" onClick={go}>Create job</Button></>}>
      {result ? (
        <div className="text-sm">
          <p>Job {result.job.job_no} created. These items may need ordering:</p>
          <ul className="mt-2 list-disc pl-5">{result.materials_to_order.map((m: any) => <li key={m.id}>{m.qty} × {m.description}</li>)}</ul>
          <p className="mt-2 text-muted">Raise a purchase order from Stock & purchasing, or ask the assistant.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Estimated hours"><Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <div className="col-span-2"><ErrorNote error={err} /></div>
        </div>
      )}
    </Modal>
  );
}
