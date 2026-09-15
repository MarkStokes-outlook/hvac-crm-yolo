import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Boxes, CalendarDays, Camera, Check, ChevronRight, Monitor, LogOut, MapPin, Navigation, Phone, Sparkles, Wrench } from 'lucide-react';
import { api, errorText, post, put, queryClient, useAction, useApi } from '../lib/api';
import { useAuth, useMeta } from '../lib/auth';
import { useAi } from '../components/AiPanel';
import { Badge, Button, ErrorNote, Input, Select, Spinner, Textarea, cx } from '../components/ui';
import { FgasBadge, Markdown, PriorityBadge, VisitStatus, KIND_LABEL } from '../components/domain';
import { date, dateTime, relative, shortDate, time, titleCase } from '../lib/format';

export default function MobileApp() {
  const { user, logout } = useAuth();
  const { setOpen } = useAi();
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col bg-paper">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-navy-900 px-4 py-3 text-white" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
        <img src="/logo.svg" alt="" className="size-8 rounded-full bg-white p-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold">{user?.name}</div>
          <div className="text-xs text-steel-100/70">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-md bg-navy-700 p-2" aria-label="Ask Frostline"><Sparkles className="size-5" /></button>
        {user?.role !== 'engineer' && <Link to="/" className="rounded-md bg-navy-700 p-2" aria-label="Desktop view"><Monitor className="size-5" /></Link>}
        <button onClick={logout} className="rounded-md p-2 hover:bg-navy-700" aria-label="Sign out"><LogOut className="size-5" /></button>
      </header>
      <main className="flex-1 pb-24">
        <Routes>
          <Route index element={<MyDay />} />
          <Route path="visits/:id" element={<VisitView />} />
          <Route path="van" element={<Van />} />
        </Routes>
      </main>
      <nav className="fixed right-0 bottom-0 left-0 z-20 mx-auto flex max-w-xl border-t border-line bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <Tab to="/m" icon={<CalendarDays className="size-5" />} label="My jobs" end />
        <Tab to="/m/van" icon={<Boxes className="size-5" />} label="Van stock" />
      </nav>
    </div>
  );
}

const Tab = ({ to, icon, label, end }: { to: string; icon: ReactNode; label: string; end?: boolean }) => (
  <NavLink to={to} end={end} className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs', isActive ? 'font-medium text-steel-600' : 'text-muted')}>
    {icon}
    {label}
  </NavLink>
);

function MyDay() {
  const { user } = useAuth();
  const { data, isLoading } = useApi<any[]>('/me/visits', { refetchInterval: 60_000 });
  if (!user?.engineer_id) return <div className="p-6 text-sm text-muted">This view is for engineers. Sign in as an engineer (e.g. Dave Whittaker) to see their jobs.</div>;
  if (isLoading) return <Spinner />;
  const byDay = new Map<string, any[]>();
  for (const v of data ?? []) {
    const k = new Date(v.starts_at).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), v]);
  }
  const todayKey = new Date().toDateString();
  return (
    <div className="space-y-5 p-4">
      {!byDay.has(todayKey) && <div className="rounded-lg bg-white p-4 text-sm text-muted">Nothing booked today.</div>}
      {[...byDay.entries()].map(([k, visits]) => (
        <section key={k}>
          <h2 className="mb-2 text-sm font-semibold text-navy-900">{k === todayKey ? 'Today' : shortDate(visits[0].starts_at)}</h2>
          <div className="space-y-2">
            {visits.map((v) => (
              <Link key={v.id} to={`/m/visits/${v.id}`} className={cx('block rounded-lg border bg-white p-4 active:bg-steel-50', ['on_site', 'travelling'].includes(v.status) ? 'border-steel-500 ring-2 ring-steel-100' : 'border-line')}>
                <div className="flex items-center justify-between">
                  <span className="num text-lg font-semibold text-navy-900">{time(v.starts_at)}</span>
                  <div className="flex items-center gap-1.5"><PriorityBadge p={v.priority} /><VisitStatus s={v.status} /></div>
                </div>
                <div className="mt-1 text-base font-medium">{v.site_name}</div>
                <div className="text-sm text-muted">{v.address}, {v.postcode}</div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="truncate">{v.title}</span>
                  <ChevronRight className="size-5 shrink-0 text-muted" />
                </div>
                <div className="mt-1 text-xs text-muted">{KIND_LABEL[v.kind]} · {v.job_no}{v.respond_by && !['completed'].includes(v.status) ? ` · attend by ${time(v.respond_by)}` : ''}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function VisitView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useApi<any>(`/visits/${id}`);
  const action = useAction((a: string) => post(`/visits/${id}/${a}`));
  const [brief, setBrief] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);
  if (isLoading) return <Spinner />;
  if (error || !data) return <div className="p-4"><ErrorNote error={errorText(error)} /></div>;
  const { visit: v, job, site_history, open_defects, contacts, van_stock, checklist_template } = data;
  const live = ['scheduled', 'accepted', 'travelling', 'on_site'].includes(v.status);
  const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${job.site_address}, ${job.site_postcode}`)}`;

  return (
    <div className="space-y-3 p-3">
      <button onClick={() => navigate('/m')} className="flex items-center gap-1 px-1 text-sm text-steel-600"><ArrowLeft className="size-4" /> My jobs</button>
      <div className="rounded-lg bg-white p-4">
        <div className="flex items-center gap-2"><PriorityBadge p={job.priority} /><Badge>{KIND_LABEL[job.kind]}</Badge><VisitStatus s={v.status} /></div>
        <h1 className="mt-2 text-lg leading-snug font-semibold text-navy-900">{job.title}</h1>
        <div className="num text-sm text-muted">{job.job_no} · {dateTime(v.starts_at)}–{time(v.ends_at)}</div>
        <div className="mt-3 text-base font-medium">{job.site_name}</div>
        <div className="text-sm text-muted">{job.customer_name}</div>
        <div className="text-sm">{job.site_address}, {job.site_town} {job.site_postcode}</div>
        {job.respond_by && !job.attended_at && <div className="mt-2 text-sm font-medium text-hot">Attend by {dateTime(job.respond_by)} ({relative(job.respond_by)})</div>}
        {v.instructions && <div className="mt-3 rounded-md bg-warn-50 px-3 py-2 text-sm">{v.instructions}</div>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a href={mapUrl} target="_blank" rel="noreferrer"><Button size="lg" className="w-full" icon={<Navigation className="size-5" />}>Directions</Button></a>
          {contacts[0]?.phone || contacts[0]?.mobile ? <a href={`tel:${(contacts[0].mobile ?? contacts[0].phone).replace(/\s/g, '')}`}><Button size="lg" className="w-full" icon={<Phone className="size-5" />}>Call site</Button></a> : <span />}
        </div>
        {live && (
          <div className="mt-2">
            {['scheduled', 'accepted'].includes(v.status) && <Button size="lg" variant="primary" className="w-full" loading={action.isPending} onClick={() => action.mutate('travel')} icon={<MapPin className="size-5" />}>Start travelling</Button>}
            {v.status === 'travelling' && <Button size="lg" variant="primary" className="w-full" loading={action.isPending} onClick={() => action.mutate('arrive')} icon={<Check className="size-5" />}>Arrived on site</Button>}
            {v.status === 'on_site' && <a href="#complete"><Button size="lg" variant="navy" className="w-full">Finish visit</Button></a>}
          </div>
        )}
        <ErrorNote error={action.error && errorText(action.error)} />
      </div>

      {(job.hazards || job.access_notes || job.induction_required || job.dbs_required) && (
        <Section title="Access & safety">
          <div className="space-y-2 text-sm">
            {job.induction_required ? <Badge tone="amber">Induction required</Badge> : null}
            {job.access_notes && <p>{job.access_notes}</p>}
            {job.hazards && <p className="flex gap-1.5 text-[#9a4a16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{job.hazards}</p>}
            {job.parking_notes && <p className="text-muted">Parking: {job.parking_notes}</p>}
            {contacts.map((c: any) => <p key={c.id}><span className="font-medium">{c.name}</span> <span className="text-muted">{c.job_title}</span> {(c.mobile || c.phone) && <a className="text-steel-600" href={`tel:${(c.mobile ?? c.phone).replace(/\s/g, '')}`}>{c.mobile ?? c.phone}</a>}</p>)}
          </div>
        </Section>
      )}

      <Section title="The job" action={<button className="flex items-center gap-1 text-xs text-steel-600" onClick={async () => { setBriefing(true); try { setBrief((await post('/ai/site-briefing', { site_id: job.site_id, job_id: job.id })).text); } catch (e) { setBrief(errorText(e)); } finally { setBriefing(false); } }}><Sparkles className="size-3.5" /> {briefing ? 'Thinking…' : 'Brief me'}</button>}>
        {brief && <div className="mb-3 rounded-md bg-steel-50 p-3 text-sm"><Markdown text={brief} /></div>}
        <p className="text-sm whitespace-pre-wrap">{job.description ?? 'No description.'}</p>
        {job.reported_by && <p className="mt-1 text-xs text-muted">Reported by {job.reported_by}</p>}
        {job.assets.length > 0 && (
          <div className="mt-3 space-y-2">
            {job.assets.map((a: any) => (
              <div key={a.id} className="rounded-md border border-line p-2.5 text-sm">
                <div className="font-medium"><span className="num">{a.tag}</span> {a.category}</div>
                <div className="text-xs text-muted">{a.manufacturer} {a.model} · {a.location}</div>
                <div className="mt-1 flex flex-wrap gap-1">{a.refrigerant && <Badge>{a.refrigerant} {a.refrigerant_kg}kg</Badge>}<FgasBadge fgas={a.fgas} /></div>
              </div>
            ))}
          </div>
        )}
        {open_defects.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-medium text-muted">Open defects at this site</div>
            {open_defects.map((d: any) => <div key={d.id} className="mt-1 text-sm"><Badge tone="amber">{titleCase(d.severity)}</Badge> {d.asset_tag} {d.description}</div>)}
          </div>
        )}
        {site_history.length > 0 && (
          <details className="mt-3">
            <summary className="text-sm text-steel-600">Previous work here ({site_history.length})</summary>
            {site_history.map((h: any) => <div key={h.id} className="mt-2 border-l-2 border-line pl-2 text-sm"><div className="text-xs text-muted">{date(h.completed_at)} · {h.job_no} · {KIND_LABEL[h.kind]}</div><div>{h.title}</div>{(h.work_summaries ?? h.resolution) && <div className="text-xs text-muted">{h.work_summaries ?? h.resolution}</div>}</div>)}
          </details>
        )}
      </Section>

      {live && checklist_template && <Checklist visit={v} job={job} template={checklist_template} />}
      {live && <PartsUsed job={job} visit={v} van={van_stock} />}
      {live && job.assets.some((a: any) => a.refrigerant) && <Refrigerant job={job} visit={v} />}
      {live && <DefectsMobile job={job} visit={v} />}
      {!live && (job.parts.length > 0 || job.defects.length > 0) && (
        <Section title="Recorded on this job">
          {job.parts.map((p: any) => <div key={p.id} className="py-0.5 text-sm">{p.qty} × {p.description}</div>)}
          {job.defects.map((d: any) => <div key={d.id} className="py-0.5 text-sm"><Badge tone="amber">{titleCase(d.severity)}</Badge> {d.description}</div>)}
        </Section>
      )}
      <PhotosMobile job={job} visit={v} />
      <NotesMobile job={job} visit={v} />
      {live && <Complete job={job} visit={v} />}
      {!live && v.work_summary && <Section title="Visit summary"><p className="text-sm">{v.work_summary}</p><p className="mt-1 text-xs text-muted">{titleCase(v.outcome)}{v.signed_by ? ` · signed by ${v.signed_by}` : ''}</p></Section>}
    </div>
  );
}

function Checklist({ visit, job, template }: any) {
  const existing = job.checklists.find((c: any) => c.visit_id === visit.id);
  const [resp, setResp] = useState<Record<string, any>>(existing?.responses ?? {});
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await put(`/visits/${visit.id}/checklist`, { template_id: template.id, responses: resp });
    setSaved(true);
    queryClient.invalidateQueries();
  };
  return (
    <Section title={template.name} action={saved && <span className="text-xs text-ok">Saved</span>}>
      <div className="space-y-2.5">
        {template.items.map((it: any) => (
          <div key={it.key}>
            {it.kind === 'check' ? (
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={!!resp[it.key]} onChange={(e) => { setResp({ ...resp, [it.key]: e.target.checked }); setSaved(false); }} /> {it.label}</label>
            ) : it.kind === 'reading' ? (
              <label className="flex items-center justify-between gap-3 text-sm">{it.label}<span className="flex items-center gap-1"><Input type="number" inputMode="decimal" step="any" className="h-10 w-24" value={resp[it.key] ?? ''} onChange={(e) => { setResp({ ...resp, [it.key]: e.target.value }); setSaved(false); }} /><span className="w-8 text-xs text-muted">{it.unit}</span></span></label>
            ) : (
              <Textarea rows={2} placeholder={it.label} value={resp[it.key] ?? ''} onChange={(e) => { setResp({ ...resp, [it.key]: e.target.value }); setSaved(false); }} />
            )}
          </div>
        ))}
        <Button className="w-full" onClick={save}>Save checklist</Button>
      </div>
    </Section>
  );
}

function PartsUsed({ job, visit, van }: any) {
  const [part, setPart] = useState('');
  const [qty, setQty] = useState('1');
  const [free, setFree] = useState('');
  const add = useAction((b: any) => post(`/jobs/${job.id}/parts`, b), () => { setPart(''); setQty('1'); setFree(''); });
  return (
    <Section title={`Parts used (${job.parts.length})`}>
      {job.parts.map((p: any) => <div key={p.id} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0"><span>{p.qty} × {p.description}</span><span className="text-xs text-muted">{p.location_name ?? ''}</span></div>)}
      <div className="mt-3 space-y-2">
        <Select value={part} onChange={(e) => setPart(e.target.value)} className="h-11">
          <option value="">From my van…</option>
          {van.map((s: any) => <option key={s.part_id} value={`${s.part_id}:${s.location_id}`}>{s.name} ({s.qty})</option>)}
        </Select>
        <div className="flex gap-2">
          <Input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 w-20" aria-label="Quantity" />
          <Button size="lg" className="flex-1" disabled={!part} onClick={() => { const [pid, lid] = part.split(':'); add.mutate({ part_id: Number(pid), location_id: Number(lid), qty: Number(qty), visit_id: visit.id }); }}>Add part</Button>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Other part (bought / not on van)" value={free} onChange={(e) => setFree(e.target.value)} className="h-11" />
          <Button size="lg" disabled={!free} onClick={() => add.mutate({ description: free, qty: Number(qty), visit_id: visit.id })}>Add</Button>
        </div>
        <ErrorNote error={add.error && errorText(add.error)} />
      </div>
    </Section>
  );
}

function Refrigerant({ job, visit }: any) {
  const [f, setF] = useState({ asset_id: '', action: 'leak_check', qty_kg: '', leak_found: false });
  const add = useAction((b: any) => post(`/jobs/${job.id}/refrigerant`, b), () => setF({ asset_id: '', action: 'leak_check', qty_kg: '', leak_found: false }));
  return (
    <Section title="Refrigerant (F-Gas record)">
      {job.refrigerant_logs.map((r: any) => <div key={r.id} className="py-1 text-sm">{r.asset_tag}: {titleCase(r.action)} {r.qty_kg ? `${r.qty_kg}kg` : ''} {r.leak_found ? <Badge tone="red">Leak</Badge> : null}</div>)}
      <div className="mt-2 space-y-2">
        <Select className="h-11" value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}>
          <option value="">Equipment…</option>
          {job.assets.filter((a: any) => a.refrigerant).map((a: any) => <option key={a.id} value={a.id}>{a.tag} — {a.refrigerant} {a.refrigerant_kg}kg</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select className="h-11" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
            <option value="leak_check">Leak check</option>
            <option value="added">Added</option>
            <option value="recovered">Recovered</option>
          </Select>
          <Input className="h-11" type="number" inputMode="decimal" step="0.01" placeholder="kg" value={f.qty_kg} onChange={(e) => setF({ ...f, qty_kg: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={f.leak_found} onChange={(e) => setF({ ...f, leak_found: e.target.checked })} /> Leak found</label>
        <Button size="lg" className="w-full" disabled={!f.asset_id} onClick={() => add.mutate({ asset_id: Number(f.asset_id), action: f.action, qty_kg: Number(f.qty_kg) || 0, leak_found: f.leak_found, visit_id: visit.id })}>Record</Button>
        <ErrorNote error={add.error && errorText(add.error)} />
      </div>
    </Section>
  );
}

function DefectsMobile({ job, visit }: any) {
  const [f, setF] = useState({ asset_id: '', severity: 'recommended', description: '', recommendation: '' });
  const add = useAction((b: any) => post(`/jobs/${job.id}/defects`, b), () => setF({ asset_id: '', severity: 'recommended', description: '', recommendation: '' }));
  return (
    <Section title={`Defects & recommendations (${job.defects.length})`}>
      {job.defects.map((d: any) => <div key={d.id} className="py-1 text-sm"><Badge tone={d.severity === 'unsafe' ? 'red' : 'amber'}>{titleCase(d.severity)}</Badge> {d.description}</div>)}
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Select className="h-11" value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}>
            <option value="">Equipment…</option>
            {job.assets.map((a: any) => <option key={a.id} value={a.id}>{a.tag}</option>)}
          </Select>
          <Select className="h-11" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            <option value="advisory">Advisory</option>
            <option value="recommended">Recommended</option>
            <option value="urgent">Urgent</option>
            <option value="unsafe">Unsafe — isolated</option>
          </Select>
        </div>
        <Textarea rows={2} placeholder="What did you find?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input className="h-11" placeholder="What do you recommend?" value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })} />
        <Button size="lg" className="w-full" disabled={f.description.length < 3} onClick={() => add.mutate({ ...f, asset_id: f.asset_id ? Number(f.asset_id) : null, visit_id: visit.id })}>Raise defect</Button>
        <p className="text-xs text-muted">The office is notified and can turn defects into a quote.</p>
      </div>
    </Section>
  );
}

function PhotosMobile({ job, visit }: any) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('entity_type', 'job');
    fd.append('entity_id', String(job.id));
    fd.append('visit_id', String(visit.id));
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
    <Section title={`Photos (${job.attachments.length})`}>
      <div className="grid grid-cols-3 gap-2">
        {job.attachments.filter((a: any) => a.mime?.startsWith('image/')).map((a: any) => <img key={a.id} src={`/api/attachments/${a.id}/file`} alt="" className="aspect-square w-full rounded object-cover" />)}
      </div>
      <label className={cx('mt-3 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong bg-white text-base font-medium', busy && 'opacity-50')}>
        <Camera className="size-5" /> {busy ? 'Uploading…' : 'Take / add photos'}
        <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </label>
      <ErrorNote error={err} />
    </Section>
  );
}

function NotesMobile({ job, visit }: any) {
  const [body, setBody] = useState('');
  const add = useAction((b: any) => post(`/jobs/${job.id}/notes`, b), () => setBody(''));
  const notes = job.notes.filter((n: any) => n.kind !== 'system').slice(0, 5);
  return (
    <Section title="Notes">
      {notes.map((n: any) => <div key={n.id} className="border-b border-line py-1.5 text-sm last:border-0"><div className="text-xs text-muted">{n.user_name} · {dateTime(n.created_at)}</div>{n.body}</div>)}
      <Textarea rows={2} className="mt-2" placeholder="Note for the office" value={body} onChange={(e) => setBody(e.target.value)} />
      <Button size="lg" className="mt-2 w-full" disabled={!body.trim()} onClick={() => add.mutate({ body, visit_id: visit.id })}>Add note</Button>
    </Section>
  );
}

function Complete({ job, visit }: any) {
  const meta = useMeta();
  const [outcome, setOutcome] = useState(job.kind === 'ppm' ? 'ppm_complete' : 'fixed');
  const [summary, setSummary] = useState('');
  const [cause, setCause] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [tidying, setTidying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [signed, setSigned] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#152536';
    let drawing = false;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      const [x, y] = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setSigned(true);
    };
    const up = () => (drawing = false);
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
    };
  }, []);

  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setSigned(false);
  };

  const tidy = async () => {
    setTidying(true);
    try {
      setSummary((await post('/ai/tidy-notes', { text: summary, context: `${job.title} at ${job.site_name}` })).text);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setTidying(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post(`/visits/${visit.id}/complete`, { outcome, work_summary: summary, cause: cause || null, signed_by: signedBy || null, signature: signed ? canvas.current!.toDataURL('image/png') : null });
      queryClient.invalidateQueries();
      navigate('/m');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="complete">
      <Section title="Finish visit">
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium">Outcome</div>
            <div className="grid grid-cols-1 gap-1.5">
              {meta && Object.entries(meta.visit_outcomes).filter(([k]) => job.kind === 'ppm' || k !== 'ppm_complete').map(([k, label]) => (
                <label key={k} className={cx('flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm', outcome === k ? 'border-steel-600 bg-steel-50' : 'border-line')}>
                  <input type="radio" name="outcome" checked={outcome === k} onChange={() => setOutcome(k)} className="size-4" /> {label as string}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm font-medium">Work carried out <button onClick={tidy} disabled={!summary || tidying} className="flex items-center gap-1 text-xs font-normal text-steel-600 disabled:opacity-40"><Sparkles className="size-3.5" /> {tidying ? 'Tidying…' : 'Tidy up'}</button></div>
            <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What you found, what you did, readings, what's needed next" />
          </div>
          {!['ppm_complete', 'no_access'].includes(outcome) && <Input className="h-11" placeholder="Root cause (e.g. failed condensate pump)" value={cause} onChange={(e) => setCause(e.target.value)} />}
          <div>
            <div className="mb-1 flex items-center justify-between text-sm font-medium">Customer sign-off <button className="text-xs font-normal text-steel-600" onClick={clear}>Clear</button></div>
            <canvas ref={canvas} className="h-32 w-full touch-none rounded-md border border-line-strong bg-white" />
            <Input className="mt-2 h-11" placeholder="Name of person signing" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />
          </div>
          <ErrorNote error={err} />
          <Button size="lg" variant="primary" className="w-full" loading={busy} disabled={summary.length < 3} onClick={submit} icon={<Wrench className="size-5" />}>Complete visit</Button>
        </div>
      </Section>
    </div>
  );
}

function Van() {
  const { data, isLoading } = useApi<any>('/me/van');
  if (isLoading) return <Spinner />;
  if (!data) return <div className="p-6 text-sm text-muted">No van stock location set up for you.</div>;
  const low = data.items.filter((i: any) => i.qty < i.min_qty);
  return (
    <div className="space-y-3 p-3">
      <div className="rounded-lg bg-white p-4">
        <div className="font-semibold text-navy-900">{data.name}</div>
        <div className="text-sm text-muted">{data.items.length} lines · {low.length} below minimum</div>
      </div>
      <div className="divide-y divide-line rounded-lg border border-line bg-white">
        {data.items.map((i: any) => (
          <div key={i.part_id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm">{i.name}</div>
              <div className="num text-xs text-muted">{i.sku}</div>
            </div>
            <div className={cx('num text-lg font-semibold', i.qty < i.min_qty ? 'text-scald' : 'text-navy-900')}>{i.qty}<span className="text-xs font-normal text-muted"> / {i.max_qty}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
