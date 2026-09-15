import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CalendarPlus, Camera, FilePlus2, MessageSquarePlus, Package, Sparkles, Trash2, UserCheck, Copy } from 'lucide-react';
import { api, del, errorText, patch, post, queryClient, useAction, useApi } from '../lib/api';
import { perms, useAuth, useMeta } from '../lib/auth';
import { useAi, useAiEntity } from '../components/AiPanel';
import { Badge, Button, Empty, ErrorNote, Field, Input, KV, Modal, PageHeader, Panel, Select, Spinner, Table, Tabs, Textarea, cx } from '../components/ui';
import { EntityLink, FgasBadge, JobStatus, KIND_LABEL, Markdown, PriorityBadge, SiteAlerts, SKILL_SHORT, SlaHeat, VisitStatus } from '../components/domain';
import { date, dateTime, fromLocalInput, money, money2, relative, time, titleCase, toLocalInput } from '../lib/format';

export default function JobDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const p = perms(user);
  const meta = useMeta();
  const { ask } = useAi();
  const { data: job, isLoading, error } = useApi<any>(`/jobs/${id}`);
  const [tab, setTab] = useState<'overview' | 'visits' | 'notes' | 'parts' | 'defects' | 'photos' | 'history'>('overview');
  const [modal, setModal] = useState<null | 'hold' | 'cancel' | 'invoice' | 'edit'>(null);
  useAiEntity(job ? { type: 'job', id: job.id, label: `${job.job_no} ${job.title}` } : null);

  const update = useAction((body: any) => patch(`/jobs/${id}`, body), () => setModal(null));

  if (isLoading) return <Spinner />;
  if (error || !job) return <ErrorNote error={error ?? 'Job not found'} />;
  const open = ['new', 'scheduled', 'in_progress', 'on_hold'].includes(job.status);
  const activeVisits = job.visits.filter((v: any) => ['scheduled', 'accepted', 'travelling', 'on_site'].includes(v.status));

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-1 text-sm text-muted">
        <EntityLink to={`/customers/${job.customer_id}`}>{job.customer_name}</EntityLink> / <EntityLink to={`/sites/${job.site_id}`}>{job.site_name}</EntityLink>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num text-muted">{job.job_no}</span> {job.title}
          </span>
        }
        actions={
          p.manageJobs && (
            <>
              <Button icon={<Sparkles className="size-4" />} onClick={() => ask(`Look at ${job.job_no} and tell me the best next step. If it needs an engineer, find the best one and book them.`)}>
                Next step?
              </Button>
              {open && job.status !== 'on_hold' && <Button onClick={() => setModal('hold')}>Put on hold</Button>}
              {job.status === 'on_hold' && <Button onClick={() => update.mutate({ status: 'new', reason: 'Released from hold' })}>Release hold</Button>}
              {open && <Button onClick={() => update.mutate({ status: 'completed' })}>Mark complete</Button>}
              {job.status === 'completed' && <Button variant="primary" onClick={() => update.mutate({ status: 'closed' })}>Review & close</Button>}
              {['completed', 'closed'].includes(job.status) && p.invoicing && job.invoice_status === 'ready' && <Button variant="primary" onClick={() => setModal('invoice')}>Mark invoiced</Button>}
              {open && <Button variant="danger" onClick={() => setModal('cancel')}>Cancel</Button>}
            </>
          )
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PriorityBadge p={job.priority} />
          <JobStatus s={job.status} hold={job.hold_reason} />
          <Badge>{KIND_LABEL[job.kind]}</Badge>
          <Badge tone={job.charge_type === 'contract' ? 'blue' : job.charge_type === 'chargeable' ? 'amber' : 'neutral'}>{titleCase(job.charge_type)}</Badge>
          {job.contract_ref && <Link to={`/contracts/${job.contract_id}`}><Badge tone="blue">{job.contract_ref}</Badge></Link>}
          {job.ooh ? <Badge tone="purple">Out of hours</Badge> : null}
          {job.on_stop ? <Badge tone="red">Customer on stop</Badge> : null}
          {job.parent_job_no && <Link to={`/jobs/${job.parent_job_id}`}><Badge tone="orange">Follow-on from {job.parent_job_no}</Badge></Link>}
        </div>
      </PageHeader>
      <ErrorNote error={update.error && errorText(update.error)} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'visits', label: 'Visits', count: job.visits.length },
              { id: 'notes', label: 'Notes', count: job.notes.filter((n: any) => n.kind !== 'system').length },
              { id: 'parts', label: 'Parts & costs', count: job.parts.length },
              { id: 'defects', label: 'Defects & F-Gas', count: job.defects.length + job.refrigerant_logs.length },
              { id: 'photos', label: 'Photos & files', count: job.attachments.length },
              { id: 'history', label: 'History' },
            ]}
          />
          {tab === 'overview' && <Overview job={job} onEdit={() => setModal('edit')} canEdit={p.manageJobs} />}
          {tab === 'visits' && <Visits job={job} canSchedule={p.schedule} />}
          {tab === 'notes' && <Notes job={job} />}
          {tab === 'parts' && <Parts job={job} />}
          {tab === 'defects' && <Defects job={job} canQuote={p.quotes} />}
          {tab === 'photos' && <Photos job={job} />}
          {tab === 'history' && (
            <Panel bodyClass="p-0">
              <Table
                dense
                rows={job.history}
                columns={[
                  { key: 'w', label: 'When', render: (h: any) => <span className="num text-xs">{dateTime(h.created_at)}</span> },
                  { key: 'u', label: 'Who', render: (h: any) => <span className="text-xs">{h.user_name ?? 'System'}{h.via_ai ? <Badge tone="blue" className="ml-1">via assistant</Badge> : null}</span> },
                  { key: 'a', label: 'Action', render: (h: any) => <span className="text-xs">{titleCase(h.action)}</span> },
                  { key: 'd', label: 'Detail', render: (h: any) => <span className="text-xs text-muted">{h.detail}</span> },
                ]}
              />
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          <Panel title="SLA">
            {job.sla_terms ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Attend</span>
                  {job.attended_at ? <span className={cx('text-sm font-medium', job.sla.response === 'met' ? 'text-ok' : 'text-scald')}>{job.sla.response === 'met' ? 'Met' : 'Late'} · {dateTime(job.attended_at)}</span> : <SlaHeat job={{ ...job, attended_at: null, sla: { ...job.sla, fix: 'none' } }} />}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Fix</span>
                  {job.completed_at ? <span className={cx('text-sm font-medium', job.sla.fix === 'met' ? 'text-ok' : job.sla.fix === 'none' ? 'text-muted' : 'text-scald')}>{job.sla.fix === 'breached' ? 'Late' : 'Done'} · {dateTime(job.completed_at)}</span> : job.fix_by ? <SlaHeat job={{ ...job, attended_at: 'x', sla: { response: 'met', fix: job.sla.fix } }} /> : <span className="text-sm text-muted">No fix target</span>}
                </div>
                <div className="border-t border-line pt-2 text-xs text-muted">
                  {job.sla_terms.source === 'contract' ? `${job.contract_ref} terms` : 'Standard terms (no reactive contract cover)'}: {job.priority} attend within {job.sla_terms.response_hours}h{job.sla_terms.fix_hours ? `, fix within ${job.sla_terms.fix_hours}h` : ''} ({job.sla_terms.basis === '24x7' ? '24/7 clock' : 'working hours'})
                </div>
              </div>
            ) : job.due_on ? (
              <div className="text-sm">
                {job.kind === 'ppm' ? 'PPM window' : 'Target'}: {date(job.target_start_on)} – <span className={cx(job.due_on < new Date().toISOString().slice(0, 10) && open && 'font-medium text-scald')}>{date(job.due_on)}</span>
              </div>
            ) : (
              <div className="text-sm text-muted">No SLA for {KIND_LABEL[job.kind].toLowerCase()} work.</div>
            )}
          </Panel>

          <Panel title="Next visit" actions={p.schedule && open && <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={() => setTab('visits')}>Book</Button>}>
            {activeVisits.length ? (
              activeVisits.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <div>
                    <div className="font-medium">{v.engineer_name}</div>
                    <div className="num text-xs text-muted">{dateTime(v.starts_at)}–{time(v.ends_at)}</div>
                  </div>
                  <VisitStatus s={v.status} />
                </div>
              ))
            ) : (
              <div className="text-sm text-muted">{open ? 'Not booked yet.' : 'None.'}</div>
            )}
          </Panel>

          <Panel title="Site access">
            <div className="space-y-2 text-sm">
              <SiteAlerts site={job} />
              {job.access_notes && <p>{job.access_notes}</p>}
              {job.hazards && <p className="flex gap-1.5 text-[#9a4a16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {job.hazards}</p>}
              {job.opening_hours && <p className="text-muted">Hours: {job.opening_hours}</p>}
              {job.parking_notes && <p className="text-muted">Parking: {job.parking_notes}</p>}
              <p className="text-muted">{job.site_address}, {job.site_town} {job.site_postcode}</p>
            </div>
          </Panel>

          <Panel title="Commercial">
            <KV
              cols={1}
              items={[
                ['Charge type', titleCase(job.charge_type)],
                ['Customer PO / WO', job.customer_ref ?? (job.po_required && job.charge_type !== 'contract' ? <span className="text-scald">Required — not supplied</span> : '—')],
                ['Not-to-exceed', job.nte_limit ? <span className={cx(job.valuation.exceeds_nte && 'font-medium text-scald')}>{money(job.nte_limit)}{job.valuation.exceeds_nte ? ' — exceeded' : ''}</span> : undefined],
                ['Value so far', job.valuation.total_chargeable != null ? money2(job.valuation.total_chargeable) : 'Covered by contract'],
                ['Invoice', `${titleCase(job.invoice_status)}${job.invoice_ref ? ` · ${job.invoice_ref}` : ''}`],
                ['From quote', job.quote_no ? <EntityLink to={`/quotes/${job.quote_id}`}>{job.quote_no}</EntityLink> : undefined],
              ]}
            />
          </Panel>
        </aside>
      </div>

      <HoldModal open={modal === 'hold'} onClose={() => setModal(null)} meta={meta} onSave={(hold_reason: string, reason: string) => update.mutate({ status: 'on_hold', hold_reason, reason })} />
      <CancelModal open={modal === 'cancel'} onClose={() => setModal(null)} onSave={(reason: string) => update.mutate({ status: 'cancelled', reason })} />
      <InvoiceModal open={modal === 'invoice'} job={job} onClose={() => setModal(null)} />
      <EditModal open={modal === 'edit'} job={job} meta={meta} onClose={() => setModal(null)} onSave={(body: any) => update.mutate(body)} />
    </div>
  );
}

function Overview({ job, onEdit, canEdit }: { job: any; onEdit: () => void; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      <Panel title="Details" actions={canEdit && <Button size="sm" onClick={onEdit}>Edit</Button>}>
        {job.description && <p className="mb-4 text-sm leading-relaxed whitespace-pre-wrap">{job.description}</p>}
        <KV
          items={[
            ['Reported by', job.reported_by ? `${job.reported_by} (${titleCase(job.reported_via)})` : titleCase(job.reported_via)],
            ['Logged', `${dateTime(job.created_at)} by ${job.logged_by_name ?? 'system'}`],
            ['Skills needed', job.required_skills.length ? job.required_skills.map((s: string) => SKILL_SHORT[s] ?? s).join(', ') : '—'],
            ['Estimate', `${job.est_hours} h`],
            ['Cause', job.cause ?? undefined],
            ['Resolution', job.resolution ?? undefined],
          ]}
        />
      </Panel>
      <Panel title="Equipment" bodyClass="p-0">
        <Table
          rows={job.assets}
          rowLink={(a: any) => `/assets/${a.id}`}
          empty="No equipment linked to this job"
          columns={[
            { key: 't', label: 'Tag', render: (a: any) => <span className="num font-medium">{a.tag}</span> },
            { key: 'c', label: 'Equipment', render: (a: any) => (<div><div>{a.category}</div><div className="text-xs text-muted">{a.manufacturer} {a.model}</div></div>) },
            { key: 'l', label: 'Location', render: (a: any) => <span className="text-xs">{a.location}</span> },
            { key: 'r', label: 'Refrigerant', render: (a: any) => (a.refrigerant ? <span className="text-xs">{a.refrigerant} {a.refrigerant_kg}kg</span> : '—') },
            { key: 's', label: '', render: (a: any) => (<div className="flex flex-wrap gap-1">{a.status !== 'operational' && <Badge tone="orange">{titleCase(a.status)}</Badge>}<FgasBadge fgas={a.fgas} /></div>) },
          ]}
        />
      </Panel>
      {job.checklists.length > 0 && (
        <Panel title="Service checklist">
          {job.checklists.map((c: any) => (
            <div key={c.id} className="mb-3">
              <div className="mb-2 text-sm font-medium">{c.template_name}{c.asset_tag ? ` — ${c.asset_tag}` : ''}</div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {c.items.map((it: any) => (
                  <div key={it.key} className="flex justify-between gap-3 border-b border-line/60 py-1">
                    <span className="text-muted">{it.label}</span>
                    <span className="num">{it.kind === 'check' ? (c.responses[it.key] ? '✓' : '—') : `${c.responses[it.key] ?? '—'}${it.unit && c.responses[it.key] != null ? ` ${it.unit}` : ''}`}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Panel>
      )}
      {(job.quotes.length > 0 || job.purchase_orders.length > 0 || job.follow_on_jobs.length > 0) && (
        <Panel title="Linked records">
          <div className="space-y-1 text-sm">
            {job.quotes.map((q: any) => <div key={q.id}>Quote <EntityLink to={`/quotes/${q.id}`}>{q.quote_no}</EntityLink> {q.title} <Badge>{titleCase(q.status)}</Badge></div>)}
            {job.purchase_orders.map((po: any) => <div key={po.id}>Purchase order <EntityLink to={`/stock/purchase-orders/${po.id}`}>{po.po_no}</EntityLink> {po.supplier_name} <Badge>{titleCase(po.status)}</Badge></div>)}
            {job.follow_on_jobs.map((j: any) => <div key={j.id}>Follow-on job <EntityLink to={`/jobs/${j.id}`}>{j.job_no}</EntityLink> {j.title} <Badge>{titleCase(j.status)}</Badge></div>)}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Visits({ job, canSchedule }: { job: any; canSchedule: boolean }) {
  const cancel = useAction((vid: number) => post(`/visits/${vid}/cancel`, { reason: 'Cancelled from job' }));
  const open = ['new', 'scheduled', 'in_progress', 'on_hold'].includes(job.status);
  return (
    <div className="space-y-4">
      {canSchedule && open && <SuggestPanel job={job} />}
      <Panel title="Visits" bodyClass="p-0">
        {job.visits.length === 0 ? (
          <Empty title="No visits yet" />
        ) : (
          <ul className="divide-y divide-line">
            {job.visits.map((v: any) => (
              <li key={v.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="size-2.5 rounded-full" style={{ background: v.engineer_colour }} />
                    <div>
                      <div className="text-sm font-medium">{v.engineer_name}</div>
                      <div className="num text-xs text-muted">{dateTime(v.starts_at)} – {time(v.ends_at)}{v.arrived_at ? ` · on site ${time(v.arrived_at)}${v.departed_at ? `–${time(v.departed_at)}` : ''}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.outcome && <Badge tone={['fixed', 'ppm_complete'].includes(v.outcome) ? 'green' : 'orange'}>{titleCase(v.outcome)}</Badge>}
                    <VisitStatus s={v.status} />
                    {canSchedule && ['scheduled', 'accepted'].includes(v.status) && (
                      <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this visit?') && cancel.mutate(v.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {v.instructions && <div className="mt-1.5 text-xs text-muted">Instructions: {v.instructions}</div>}
                {v.work_summary && <div className="mt-2 rounded-md bg-paper px-3 py-2 text-sm">{v.work_summary}</div>}
                {v.signed_by && <div className="mt-1 text-xs text-muted">Signed off by {v.signed_by}</div>}
                {v.signature && <img src={v.signature} alt="Customer signature" className="mt-1 h-12 rounded border border-line bg-white" />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Ranked engineer suggestions with one-click booking, plus manual booking. */
export function SuggestPanel({ job, onBooked }: { job: any; onBooked?: () => void }) {
  const [days, setDays] = useState(5);
  const { data, isLoading, error } = useApi<any>(`suggest:${job.id}:${days}`, { queryFn: () => post('/schedule/suggest', { job_id: job.id, days }) } as any);
  const engineers = useApi<any[]>('/engineers');
  const [manual, setManual] = useState({ engineer_id: '', starts_at: '', hours: String(job.est_hours ?? 2), instructions: '' });
  const [err, setErr] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const book = useAction(
    (body: any) => post('/visits', body),
    () => {
      setErr(null);
      onBooked?.();
    },
  );
  const doBook = (body: any) => {
    setErr(null);
    book.mutate(body, { onError: (e) => { setErr(errorText(e)); setForce(/already booked|absent/.test(errorText(e))); } });
  };

  return (
    <Panel
      title={<span className="flex items-center gap-2"><UserCheck className="size-4 text-steel-600" /> Who can attend</span>}
      actions={
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-7 w-auto text-xs">
          <option value={2}>Next 2 days</option>
          <option value={5}>Next 5 days</option>
          <option value={10}>Next 10 days</option>
        </Select>
      }
      bodyClass="p-0"
    >
      {isLoading && <Spinner label="Checking skills, tickets, travel and diaries…" />}
      {error && <div className="p-4"><ErrorNote error={errorText(error)} /></div>}
      {data && data.suggestions.length === 0 && <Empty title="Nobody available in this window">Try a longer window, a subcontractor, or book manually below.</Empty>}
      {data && (
        <ul className="divide-y divide-line">
          {data.suggestions.map((s: any, i: number) => (
            <li key={s.engineer_id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', i === 0 && 'bg-steel-50/60')}>
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.engineer_name} {i === 0 && <Badge tone="blue">Best match</Badge>}
                  {s.meets_sla === false && <Badge tone="red">Misses SLA</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">{s.reasons.join(' · ')}</div>
                {s.warnings.length > 0 && <div className="mt-0.5 text-xs text-[#9a4a16]">{s.warnings.join(' · ')}</div>}
              </div>
              <div className="num text-right text-sm">
                <div className="font-semibold text-navy-900">{dateTime(s.slot_start)}</div>
                <div className="text-xs text-muted">{s.booked_hours_that_day}h already booked</div>
              </div>
              <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} loading={book.isPending && book.variables?.engineer_id === s.engineer_id} onClick={() => doBook({ job_id: job.id, engineer_id: s.engineer_id, starts_at: s.slot_start, duration_hours: job.est_hours })}>
                Book
              </Button>
            </li>
          ))}
        </ul>
      )}
      <details className="border-t border-line px-4 py-3">
        <summary className="cursor-pointer text-sm text-steel-600">Book manually</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Engineer" className="sm:col-span-2">
            <Select value={manual.engineer_id} onChange={(e) => setManual({ ...manual, engineer_id: e.target.value })}>
              <option value="">Choose…</option>
              {engineers.data?.map((e) => <option key={e.id} value={e.id}>{e.name}{e.kind === 'subcontractor' ? ` (${e.company})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Start">
            <Input type="datetime-local" value={manual.starts_at} onChange={(e) => setManual({ ...manual, starts_at: e.target.value })} />
          </Field>
          <Field label="Hours">
            <Input type="number" step="0.5" value={manual.hours} onChange={(e) => setManual({ ...manual, hours: e.target.value })} />
          </Field>
          <Field label="Instructions for engineer" className="sm:col-span-4">
            <Input value={manual.instructions} onChange={(e) => setManual({ ...manual, instructions: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" disabled={!manual.engineer_id || !manual.starts_at} onClick={() => doBook({ job_id: job.id, engineer_id: Number(manual.engineer_id), starts_at: fromLocalInput(manual.starts_at), duration_hours: Number(manual.hours), instructions: manual.instructions || undefined, force })}>
            {force ? 'Book anyway' : 'Book visit'}
          </Button>
        </div>
      </details>
      {err && <div className="px-4 pb-3"><ErrorNote error={err} /></div>}
    </Panel>
  );
}

function Notes({ job }: { job: any }) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('note');
  const add = useAction((b: any) => post(`/jobs/${job.id}/notes`, b), () => setBody(''));
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const makeDraft = async (tone: 'email' | 'sms') => {
    setDrafting(true);
    setDraftErr(null);
    try {
      setDraft((await post('/ai/customer-update', { job_id: job.id, tone })).text);
    } catch (e) {
      setDraftErr(errorText(e));
    } finally {
      setDrafting(false);
    }
  };
  return (
    <div className="space-y-4">
      <Panel>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note — calls with the customer, access arrangements, anything the next person needs to know" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
            <option value="note">Internal note</option>
            <option value="customer_update">Update given to customer</option>
          </Select>
          <Button variant="primary" icon={<MessageSquarePlus className="size-4" />} disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate({ body, kind })}>
            Add note
          </Button>
          <div className="flex-1" />
          <Button icon={<Sparkles className="size-4" />} loading={drafting} onClick={() => makeDraft('email')}>Draft customer update</Button>
          <Button variant="ghost" loading={drafting} onClick={() => makeDraft('sms')}>SMS</Button>
        </div>
        <ErrorNote error={draftErr} />
        {draft && (
          <div className="mt-3 rounded-md border border-steel-100 bg-steel-50 p-3">
            <div className="text-sm whitespace-pre-wrap">{draft}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(draft)}>Copy</Button>
              <Button size="sm" onClick={() => { add.mutate({ body: draft, kind: 'customer_update' }); setDraft(null); }}>Save as customer update</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel bodyClass="p-0">
        <ul className="divide-y divide-line">
          {job.notes.map((n: any) => (
            <li key={n.id} className={cx('px-4 py-2.5', n.kind === 'system' && 'bg-paper/60')}>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="font-medium text-ink">{n.user_name ?? 'System'}</span>
                {n.kind !== 'note' && <Badge tone={n.kind === 'engineer' ? 'purple' : n.kind === 'customer_update' ? 'green' : 'neutral'}>{n.kind === 'system' ? 'System' : titleCase(n.kind)}</Badge>}
                <span className="num">{dateTime(n.created_at)}</span>
              </div>
              <div className={cx('mt-1 text-sm whitespace-pre-wrap', n.kind === 'system' && 'text-muted')}>{n.body}</div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Parts({ job }: { job: any }) {
  const [search, setSearch] = useState('');
  const parts = useApi<any[]>(search.length >= 2 ? `/parts?search=${encodeURIComponent(search)}` : null);
  const locations = useApi<any[]>('/stock/locations');
  const [sel, setSel] = useState<any>(null);
  const [qty, setQty] = useState('1');
  const [loc, setLoc] = useState('');
  const [free, setFree] = useState({ description: '', unit_cost: '' });
  const add = useAction((b: any) => post(`/jobs/${job.id}/parts`, b), () => { setSel(null); setSearch(''); setQty('1'); setFree({ description: '', unit_cost: '' }); });
  const remove = useAction((lineId: number) => del(`/jobs/${job.id}/parts/${lineId}`));
  const v = job.valuation;
  return (
    <div className="space-y-4">
      <Panel title="Parts used" bodyClass="p-0">
        <Table
          rows={job.parts}
          empty="No parts recorded"
          columns={[
            { key: 'd', label: 'Part', render: (p: any) => (<div>{p.description}<div className="num text-xs text-muted">{p.sku}</div></div>) },
            { key: 'q', label: 'Qty', render: (p: any) => <span className="num">{p.qty}</span> },
            { key: 'l', label: 'From', render: (p: any) => <span className="text-xs text-muted">{p.location_name ?? 'Ordered / direct'}</span> },
            { key: 'c', label: 'Cost', render: (p: any) => <span className="num">{money2(p.unit_cost * p.qty)}</span>, className: 'text-right' },
            { key: 's', label: 'Sell', render: (p: any) => <span className="num">{money2(p.unit_price * p.qty)}</span>, className: 'text-right' },
            { key: 'x', label: '', render: (p: any) => <button onClick={() => remove.mutate(p.id)} className="text-muted hover:text-scald" aria-label="Remove"><Trash2 className="size-4" /></button> },
          ]}
        />
        <div className="border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_90px_200px_auto]">
            <div className="relative">
              <Input placeholder="Search catalogue (SKU or name)…" value={sel ? `${sel.sku} ${sel.name}` : search} onChange={(e) => { setSel(null); setSearch(e.target.value); }} />
              {!sel && parts.data && parts.data.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-white shadow-lg">
                  {parts.data.slice(0, 10).map((pt) => (
                    <li key={pt.id}>
                      <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-steel-50" onClick={() => setSel(pt)}>
                        {pt.name} <span className="num text-xs text-muted">{pt.sku} · depot {pt.depot_qty} · vans {pt.van_qty}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" />
            <Select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Take from">
              <option value="">Not from stock</option>
              {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Button icon={<Package className="size-4" />} disabled={!sel} onClick={() => add.mutate({ part_id: sel.id, qty: Number(qty), location_id: loc ? Number(loc) : null })}>Add</Button>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-steel-600">Non-catalogue item</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_90px_120px_auto]">
              <Input placeholder="Description" value={free.description} onChange={(e) => setFree({ ...free, description: e.target.value })} />
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input type="number" placeholder="Unit cost £" value={free.unit_cost} onChange={(e) => setFree({ ...free, unit_cost: e.target.value })} />
              <Button disabled={!free.description} onClick={() => add.mutate({ description: free.description, qty: Number(qty), unit_cost: Number(free.unit_cost) || 0 })}>Add</Button>
            </div>
          </details>
          <ErrorNote error={add.error && errorText(add.error)} />
        </div>
      </Panel>
      <Panel title="Job value">
        <KV
          cols={3}
          items={[
            ['Labour on site', `${v.labour_hours} h @ ${money(v.labour_rate)}`],
            ['Labour value', money2(v.labour_value)],
            ['Call-out', money2(v.callout_value)],
            ['Parts cost', money2(v.parts_cost)],
            ['Parts sell', money2(v.parts_value)],
            ['Total chargeable', v.total_chargeable != null ? <span className="font-semibold">{money2(v.total_chargeable)}</span> : 'Contract'],
          ]}
        />
        {job.charge_type === 'contract' && <p className="mt-3 text-xs text-muted">Covered by {job.contract_ref}. Parts beyond the contract limit may be rechargeable — check contract terms.</p>}
      </Panel>
    </div>
  );
}

function Defects({ job, canQuote }: { job: any; canQuote: boolean }) {
  const { ask } = useAi();
  const [form, setForm] = useState({ asset_id: '', severity: 'recommended', description: '', recommendation: '' });
  const add = useAction((b: any) => post(`/jobs/${job.id}/defects`, b), () => setForm({ asset_id: '', severity: 'recommended', description: '', recommendation: '' }));
  const [ref, setRef] = useState({ asset_id: '', action: 'leak_check', qty_kg: '', leak_found: false, notes: '' });
  const addRef = useAction((b: any) => post(`/jobs/${job.id}/refrigerant`, b), () => setRef({ asset_id: '', action: 'leak_check', qty_kg: '', leak_found: false, notes: '' }));
  const openDefects = job.defects.filter((d: any) => d.status === 'open');
  return (
    <div className="space-y-4">
      <Panel
        title="Defects & recommendations"
        actions={canQuote && openDefects.length > 0 && <Button size="sm" variant="primary" icon={<FilePlus2 className="size-3.5" />} onClick={() => ask(`Draft a quote for the open defects on ${job.job_no} (defect ids ${openDefects.map((d: any) => d.id).join(', ')}). Use the parts catalogue and rate card, link the defects, and summarise the price and any assumptions.`)}>Quote for open defects</Button>}
        bodyClass="p-0"
      >
        <Table
          rows={job.defects}
          empty="No defects raised"
          columns={[
            { key: 's', label: 'Severity', render: (d: any) => <Badge tone={d.severity === 'unsafe' ? 'red' : d.severity === 'urgent' ? 'orange' : d.severity === 'recommended' ? 'amber' : 'neutral'}>{titleCase(d.severity)}</Badge> },
            { key: 'a', label: 'Equipment', render: (d: any) => <span className="num text-xs">{d.asset_tag ?? '—'}</span> },
            { key: 'd', label: 'Defect', render: (d: any) => (<div className="max-w-md"><div>{d.description}</div>{d.recommendation && <div className="text-xs text-muted">→ {d.recommendation}</div>}</div>) },
            { key: 'st', label: 'Status', render: (d: any) => (<div>{titleCase(d.status)}{d.quote_no && <div><EntityLink to={`/quotes/${d.quote_id}`} className="text-xs">{d.quote_no}</EntityLink></div>}</div>) },
          ]}
        />
        <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-4">
          <Select value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
            <option value="">No specific equipment</option>
            {job.assets.map((a: any) => <option key={a.id} value={a.id}>{a.tag} {a.category}</option>)}
          </Select>
          <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="advisory">Advisory</option>
            <option value="recommended">Recommended</option>
            <option value="urgent">Urgent</option>
            <option value="unsafe">Unsafe — isolate</option>
          </Select>
          <Input className="sm:col-span-2" placeholder="Defect found" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input className="sm:col-span-3" placeholder="Recommendation" value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} />
          <Button disabled={form.description.length < 3} onClick={() => add.mutate({ ...form, asset_id: form.asset_id ? Number(form.asset_id) : null })}>Raise defect</Button>
        </div>
      </Panel>
      <Panel title="Refrigerant record (F-Gas)" bodyClass="p-0">
        <Table
          rows={job.refrigerant_logs}
          empty="No refrigerant handling recorded on this job"
          columns={[
            { key: 'd', label: 'Date', render: (r: any) => <span className="num text-xs">{date(r.logged_on)}</span> },
            { key: 'a', label: 'Equipment', render: (r: any) => r.asset_tag },
            { key: 'x', label: 'Action', render: (r: any) => titleCase(r.action) },
            { key: 'q', label: 'Qty', render: (r: any) => <span className="num">{r.qty_kg} kg {r.refrigerant}</span> },
            { key: 'l', label: 'Leak', render: (r: any) => (r.leak_found ? <Badge tone="red">Leak found</Badge> : <span className="text-xs text-muted">None</span>) },
            { key: 'e', label: 'Engineer', render: (r: any) => <span className="text-xs">{r.engineer_name}</span> },
          ]}
        />
        {job.assets.some((a: any) => a.refrigerant) && (
          <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-5">
            <Select value={ref.asset_id} onChange={(e) => setRef({ ...ref, asset_id: e.target.value })}>
              <option value="">Equipment…</option>
              {job.assets.filter((a: any) => a.refrigerant).map((a: any) => <option key={a.id} value={a.id}>{a.tag} ({a.refrigerant})</option>)}
            </Select>
            <Select value={ref.action} onChange={(e) => setRef({ ...ref, action: e.target.value })}>
              <option value="leak_check">Leak check</option>
              <option value="added">Refrigerant added</option>
              <option value="recovered">Refrigerant recovered</option>
            </Select>
            <Input type="number" step="0.01" placeholder="kg" value={ref.qty_kg} onChange={(e) => setRef({ ...ref, qty_kg: e.target.value })} />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={ref.leak_found} onChange={(e) => setRef({ ...ref, leak_found: e.target.checked })} /> Leak found</label>
            <Button disabled={!ref.asset_id} onClick={() => addRef.mutate({ asset_id: Number(ref.asset_id), action: ref.action, qty_kg: Number(ref.qty_kg) || 0, leak_found: ref.leak_found })}>Record</Button>
            <div className="sm:col-span-5"><ErrorNote error={addRef.error && errorText(addRef.error)} /></div>
          </div>
        )}
      </Panel>
    </div>
  );
}

export function Photos({ job, entityType = 'job', visitId }: { job: any; entityType?: string; visitId?: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append('entity_type', entityType);
    fd.append('entity_id', String(job.id));
    if (visitId) fd.append('visit_id', String(visitId));
    for (const f of Array.from(files)) fd.append('files', f);
    try {
      await api('/attachments', { method: 'POST', body: fd });
      queryClient.invalidateQueries();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Photos & files"
      actions={
        <label className={cx('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-white px-2.5 text-[13px] font-medium hover:border-steel-500', busy && 'opacity-50')}>
          <Camera className="size-3.5" /> {busy ? 'Uploading…' : 'Add'}
          <input type="file" multiple accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
        </label>
      }
    >
      <ErrorNote error={err} />
      {job.attachments.length === 0 ? (
        <Empty title="No photos yet">Engineers can add photos from the mobile app, or upload here.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {job.attachments.map((a: any) => (
            <a key={a.id} href={`/api/attachments/${a.id}/file`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-line">
              {a.mime?.startsWith('image/') ? <img src={`/api/attachments/${a.id}/file`} alt={a.caption ?? a.filename} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-paper text-xs text-muted">{a.filename}</div>}
              <div className="truncate px-2 py-1 text-xs text-muted">{relative(a.created_at)}</div>
            </a>
          ))}
        </div>
      )}
    </Panel>
  );
}

function HoldModal({ open, onClose, onSave, meta }: any) {
  const [reason, setReason] = useState('awaiting_parts');
  const [note, setNote] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Put job on hold" footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" onClick={() => onSave(reason, note)}>Put on hold</Button></>}>
      <div className="space-y-3">
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {meta && Object.entries(meta.hold_reasons).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fan motor on PO-00012, due Thursday" />
        </Field>
      </div>
    </Modal>
  );
}

function CancelModal({ open, onClose, onSave }: any) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Cancel job" footer={<><Button onClick={onClose}>Back</Button><Button variant="danger" disabled={!reason} onClick={() => onSave(reason)}>Cancel job</Button></>}>
      <p className="mb-3 text-sm text-muted">Booked visits will be cancelled too.</p>
      <Field label="Reason">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer resolved it themselves" />
      </Field>
    </Modal>
  );
}

function InvoiceModal({ open, onClose, job }: any) {
  const [ref, setRef] = useState('');
  const [value, setValue] = useState(String(job.valuation.total_chargeable ?? ''));
  const save = useAction((b: any) => post(`/jobs/${job.id}/invoice`, b), onClose);
  return (
    <Modal open={open} onClose={onClose} title="Record invoice" footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" disabled={!ref} loading={save.isPending} onClick={() => save.mutate({ invoice_ref: ref, invoice_value: Number(value) || undefined })}>Save</Button></>}>
      <p className="mb-3 text-sm text-muted">Raise the invoice in the accounts package, then record its number here.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Invoice number"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Net value (£)"><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      </div>
      <ErrorNote error={save.error && errorText(save.error)} />
    </Modal>
  );
}

function EditModal({ open, onClose, onSave, job, meta }: any) {
  const [f, setF] = useState({ title: job.title, description: job.description ?? '', priority: job.priority, customer_ref: job.customer_ref ?? '', nte_limit: job.nte_limit ?? '', est_hours: job.est_hours, charge_type: job.charge_type });
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${job.job_no}`} width="max-w-2xl" footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" onClick={() => onSave({ ...f, nte_limit: f.nte_limit === '' ? null : Number(f.nte_limit), est_hours: Number(f.est_hours) })}>Save changes</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Summary" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Priority" hint="Changing priority recalculates SLA targets"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Charge type"><Select value={f.charge_type} onChange={(e) => setF({ ...f, charge_type: e.target.value })}>{['contract', 'chargeable', 'quoted', 'warranty', 'non_chargeable'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></Field>
        <Field label="Customer PO / WO"><Input value={f.customer_ref} onChange={(e) => setF({ ...f, customer_ref: e.target.value })} /></Field>
        <Field label="Not-to-exceed (£)"><Input type="number" value={f.nte_limit} onChange={(e) => setF({ ...f, nte_limit: e.target.value })} /></Field>
        <Field label="Estimated hours"><Input type="number" step="0.5" value={f.est_hours} onChange={(e) => setF({ ...f, est_hours: e.target.value })} /></Field>
      </div>
      {meta && null}
    </Modal>
  );
}

export { Markdown };
