import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Sparkles, Search } from 'lucide-react';
import { errorText, post, useApi } from '../lib/api';
import { useMeta } from '../lib/auth';
import { Badge, Button, ErrorNote, Field, Input, PageHeader, Panel, Select, Textarea, cx } from '../components/ui';
import { FgasBadge, PriorityBadge, SiteAlerts, SKILL_SHORT } from '../components/domain';
import { SuggestPanel } from './JobDetail';

export default function NewJob() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const meta = useMeta();
  const [siteSearch, setSiteSearch] = useState('');
  const [siteId, setSiteId] = useState<number | null>(params.get('site_id') ? Number(params.get('site_id')) : null);
  const sites = useApi<any[]>(siteSearch.length >= 2 ? `/sites?search=${encodeURIComponent(siteSearch)}` : null);
  const site = useApi<any>(siteId ? `/sites/${siteId}` : null);
  const [form, setForm] = useState({
    kind: 'reactive',
    priority: params.get('priority') ?? 'P3',
    title: params.get('title') ?? '',
    description: params.get('description') ?? '',
    reported_by: params.get('reported_by') ?? '',
    reported_contact_id: '',
    reported_via: params.get('reported_via') ?? 'phone',
    customer_ref: params.get('customer_ref') ?? '',
    nte_limit: '',
    est_hours: '2',
    override_on_stop: false,
  });
  const [assetIds, setAssetIds] = useState<number[]>(params.get('assets') ? params.get('assets')!.split(',').filter(Boolean).map(Number) : []);
  const [skills, setSkills] = useState<string[]>(params.get('skills') ? params.get('skills')!.split(',').filter(Boolean) : []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [triageNote, setTriageNote] = useState<string | null>(null);
  const [created, setCreated] = useState<any>(null);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (site.data && !form.reported_by) {
      const c = site.data.contacts.find((x: any) => x.site_id === site.data.id) ?? site.data.contacts[0];
      if (c) setForm((f) => ({ ...f, reported_by: c.name, reported_contact_id: String(c.id) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.data?.id]);

  const inferredSkills = useMemo(() => {
    if (!site.data || !meta) return [];
    const cats = site.data.assets.filter((a: any) => assetIds.includes(a.id)).map((a: any) => a.category);
    const map: Record<string, string[]> = meta.category_skills;
    return [...new Set(cats.flatMap((c: string) => map[c] ?? []))] as string[];
  }, [site.data, assetIds, meta]);

  const triage = async () => {
    if (!form.description && !form.title) return;
    setTriaging(true);
    setTriageNote(null);
    try {
      const t = await post('/ai/triage', { text: `${form.title}\n${form.description}`, site_id: siteId, customer_id: site.data?.customer_id });
      setForm((f) => ({ ...f, priority: t.priority, title: f.title || t.summary }));
      if (t.required_skills?.length) setSkills(t.required_skills);
      if (!siteId && t.site_candidates?.length === 1) setSiteId(t.site_candidates[0].id);
      if (siteId && t.asset_candidates?.length && !assetIds.length) setAssetIds([t.asset_candidates[0].id]);
      if (t.customer_ref && !form.customer_ref) set('customer_ref', t.customer_ref);
      setTriageNote(`${t.priority}: ${t.priority_reason}${t.source === 'rules' ? ' (rule-based)' : ''}`);
    } catch (e) {
      setTriageNote(errorText(e));
    } finally {
      setTriaging(false);
    }
  };

  const submit = async () => {
    if (!siteId) return setError('Choose a site first');
    setSaving(true);
    setError(null);
    try {
      const res = await post('/jobs', {
        site_id: siteId,
        kind: form.kind,
        priority: form.priority,
        title: form.title,
        description: form.description || null,
        reported_by: form.reported_by || null,
        reported_contact_id: form.reported_contact_id ? Number(form.reported_contact_id) : null,
        reported_via: form.reported_via,
        customer_ref: form.customer_ref || null,
        nte_limit: form.nte_limit ? Number(form.nte_limit) : null,
        est_hours: Number(form.est_hours) || 2,
        asset_ids: assetIds,
        required_skills: skills.length ? skills : undefined,
        enquiry_id: params.get('enquiry_id') ? Number(params.get('enquiry_id')) : undefined,
        override_on_stop: form.override_on_stop,
      });
      setCreated(res);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    const j = created.job;
    return (
      <div className="mx-auto max-w-[1100px]">
        <PageHeader title={<>Logged <span className="num">{j.job_no}</span></>} subtitle={`${j.title} — ${j.site_name}`} actions={<Link to={`/jobs/${j.id}`}><Button>Open job</Button></Link>} />
        {created.warnings.length > 0 && (
          <div className="mb-4 space-y-1 rounded-md border border-warm/40 bg-warn-50 p-3 text-sm text-[#7a4b0c]">
            {created.warnings.map((w: string) => (
              <div key={w} className="flex items-center gap-2"><AlertTriangle className="size-4" /> {w}</div>
            ))}
          </div>
        )}
        <SuggestPanel job={j} onBooked={() => navigate(`/jobs/${j.id}`)} />
      </div>
    );
  }

  const s = site.data;
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Log a call" subtitle="Record a fault or request, then book an engineer" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Site">
            {!s ? (
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
                  <Input autoFocus placeholder="Site name, customer, town or postcode" value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} className="pl-8" />
                </div>
                <ul className="mt-2 divide-y divide-line">
                  {sites.data?.slice(0, 8).map((x) => (
                    <li key={x.id}>
                      <button onClick={() => setSiteId(x.id)} className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-steel-50">
                        <div>
                          <div className="text-sm font-medium">{x.name}</div>
                          <div className="text-xs text-muted">{x.customer_name} · {x.address}, {x.postcode}</div>
                        </div>
                        {x.contract_ref ? <Badge tone="blue">{x.contract_ref}</Badge> : <Badge>No contract</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link to={`/sites/${s.id}`} className="font-semibold text-navy-900 hover:underline">{s.name}</Link>
                    <div className="text-sm text-muted">{s.customer_name} · {s.address}, {s.town} {s.postcode}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setSiteId(null); setAssetIds([]); }}>Change</Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.on_stop ? <Badge tone="red">Account on stop</Badge> : null}
                  {s.po_required ? <Badge tone="amber">PO required</Badge> : null}
                  {s.contract ? <Badge tone="blue">{s.contract.ref} · {s.contract.level.replace('_', ' + ')}{s.contract.ooh_cover ? ' · OOH' : ''}</Badge> : <Badge tone="orange">No active contract — chargeable</Badge>}
                </div>
                <div className="mt-2"><SiteAlerts site={s} /></div>
                {s.contract?.sla?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                    {s.contract.sla.map((t: any) => (
                      <span key={t.priority}><span className="font-medium text-ink">{t.priority}</span> attend {t.response_hours}h{t.basis === '24x7' ? ' (24/7)' : ''}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Fault" actions={<Button size="sm" icon={<Sparkles className="size-3.5" />} loading={triaging} onClick={triage}>Suggest priority</Button>}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Summary" className="sm:col-span-2">
                <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Server room AC not cooling" />
              </Field>
              <Field label="What the customer reported" className="sm:col-span-2">
                <Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Symptoms, error codes, areas affected, what's at risk…" />
              </Field>
              {triageNote && <div className="rounded-md bg-steel-50 px-3 py-2 text-sm text-navy-800 sm:col-span-2">{triageNote}</div>}
              <Field label="Type">
                <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                  {meta && Object.entries(meta.job_kinds).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                </Select>
              </Field>
              <Field label="Priority" hint={meta?.priorities[form.priority]?.description}>
                <div className="flex gap-1">
                  {['P1', 'P2', 'P3', 'P4'].map((p) => (
                    <button key={p} type="button" onClick={() => set('priority', p)} className={cx('num h-9 flex-1 rounded-md border text-sm font-semibold', form.priority === p ? (p === 'P1' ? 'border-scald bg-scald text-white' : p === 'P2' ? 'border-hot bg-hot text-white' : 'border-steel-600 bg-steel-600 text-white') : 'border-line-strong bg-white text-ink hover:border-steel-500')}>
                      {p}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Reported by">
                <Input value={form.reported_by} onChange={(e) => set('reported_by', e.target.value)} list="contacts" />
                <datalist id="contacts">{s?.contacts.map((c: any) => <option key={c.id} value={c.name}>{c.job_title}</option>)}</datalist>
              </Field>
              <Field label="Received via">
                <Select value={form.reported_via} onChange={(e) => set('reported_via', e.target.value)}>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="web">Website</option>
                  <option value="engineer">Engineer</option>
                  <option value="internal">Internal</option>
                </Select>
              </Field>
              <Field label="Customer PO / work order" hint={s?.po_required ? 'This customer requires a PO for chargeable work' : undefined}>
                <Input value={form.customer_ref} onChange={(e) => set('customer_ref', e.target.value)} />
              </Field>
              <Field label="Not-to-exceed (£)">
                <Input type="number" value={form.nte_limit} onChange={(e) => set('nte_limit', e.target.value)} />
              </Field>
              <Field label="Estimated hours">
                <Input type="number" step="0.5" value={form.est_hours} onChange={(e) => set('est_hours', e.target.value)} />
              </Field>
              <Field label="Skills needed" hint={!skills.length && inferredSkills.length ? `From equipment: ${inferredSkills.map((x) => SKILL_SHORT[x]).join(', ')}` : undefined}>
                <div className="flex flex-wrap gap-1">
                  {meta && Object.keys(meta.skills).map((k) => (
                    <button key={k} type="button" onClick={() => setSkills((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))} className={cx('rounded border px-1.5 py-0.5 text-xs', skills.includes(k) ? 'border-steel-600 bg-steel-600 text-white' : 'border-line bg-white text-muted hover:border-steel-500')}>
                      {SKILL_SHORT[k]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Equipment affected" bodyClass="p-0">
            {!s ? (
              <div className="p-4 text-sm text-muted">Choose a site to see its equipment.</div>
            ) : s.assets.length === 0 ? (
              <div className="p-4 text-sm text-muted">No equipment recorded at this site.</div>
            ) : (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {s.assets.filter((a: any) => a.status !== 'decommissioned').map((a: any) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 px-4 py-2 hover:bg-paper">
                      <input type="checkbox" className="mt-1" checked={assetIds.includes(a.id)} onChange={(e) => setAssetIds((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm"><span className="num font-medium">{a.tag}</span> {a.category}</div>
                        <div className="truncate text-xs text-muted">{a.manufacturer} {a.model} · {a.location}</div>
                        <div className="mt-0.5 flex gap-1">{a.status !== 'operational' && <Badge tone="orange">{a.status.replace(/_/g, ' ')}</Badge>}{a.refrigerant === 'R22' && <Badge tone="red">R22</Badge>}<FgasBadge fgas={a.fgas} /></div>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {s?.jobs?.filter((j: any) => ['new', 'scheduled', 'in_progress', 'on_hold'].includes(j.status)).length > 0 && (
            <Panel title="Already open at this site">
              {s.jobs.filter((j: any) => ['new', 'scheduled', 'in_progress', 'on_hold'].includes(j.status)).map((j: any) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center gap-2 py-1 text-sm hover:underline">
                  <PriorityBadge p={j.priority} /> <span className="num text-muted">{j.job_no}</span> <span className="truncate">{j.title}</span>
                </Link>
              ))}
            </Panel>
          )}
          {s?.on_stop ? (
            <label className="flex items-start gap-2 rounded-md border border-scald/30 bg-scald-50 p-3 text-sm text-scald">
              <input type="checkbox" checked={form.override_on_stop} onChange={(e) => set('override_on_stop', e.target.checked)} className="mt-0.5" />
              Account is on stop. Tick only if a manager has approved attendance.
            </label>
          ) : null}
          <ErrorNote error={error} />
          <Button variant="primary" size="lg" className="w-full" loading={saving} disabled={!siteId || form.title.length < 3} onClick={submit}>
            Log job & find an engineer
          </Button>
          <div className="text-center text-xs text-muted">SLA targets and contract cover are applied automatically. <PriorityBadge p={form.priority} /></div>
        </div>
      </div>
    </div>
  );
}
