import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ClipboardPlus, Plus, Sparkles } from 'lucide-react';
import { errorText, patch, post, queryClient, useApi } from '../lib/api';
import { perms, useAuth, useMeta } from '../lib/auth';
import { useAi, useAiEntity } from '../components/AiPanel';
import { Badge, Button, ErrorNote, KV, PageHeader, Panel, Spinner, Table, Tabs } from '../components/ui';
import { EntityLink, FgasBadge, JobStatus, KIND_LABEL, Markdown, PriorityBadge, QuoteStatus, SiteAlerts } from '../components/domain';
import { FormModal, type FieldSpec } from '../components/FormModal';
import { siteFields, contactFields } from './CustomerDetail';
import { date, money, titleCase } from '../lib/format';

export function assetFields(meta: any): FieldSpec[] {
  return [
    { name: 'tag', label: 'Tag / ID', hint: 'Leave blank to auto-number' },
    { name: 'category', label: 'Category', type: 'select', required: true, options: (meta?.asset_categories ?? []).map((c: string) => [c, c]) },
    { name: 'manufacturer', label: 'Manufacturer' },
    { name: 'model', label: 'Model' },
    { name: 'serial_number', label: 'Serial number' },
    { name: 'location', label: 'Location on site' },
    { name: 'install_date', label: 'Install date', type: 'date' },
    { name: 'warranty_expires', label: 'Warranty expires', type: 'date' },
    { name: 'refrigerant', label: 'Refrigerant', type: 'select', options: (meta?.refrigerants ?? []).map((r: string) => [r, r]) },
    { name: 'refrigerant_kg', label: 'Refrigerant charge (kg)', type: 'number' },
    { name: 'capacity_kw', label: 'Capacity (kW)', type: 'number' },
    { name: 'last_leak_check_on', label: 'Last leak check', type: 'date' },
    { name: 'condition', label: 'Condition', type: 'select', options: [['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['end_of_life', 'End of life']] },
    { name: 'status', label: 'Status', type: 'select', options: [['operational', 'Operational'], ['faulty', 'Faulty'], ['out_of_service', 'Out of service'], ['decommissioned', 'Decommissioned']] },
    { name: 'leak_detection', label: 'Automatic leak detection fitted', type: 'checkbox' },
    { name: 'installed_by_us', label: 'Installed by Frostline', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

export default function SiteDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const p = perms(user);
  const meta = useMeta();
  const { ask } = useAi();
  const { data: s, isLoading } = useApi<any>(`/sites/${id}`);
  const [tab, setTab] = useState<'equipment' | 'jobs' | 'defects' | 'ppm' | 'quotes'>('equipment');
  const [modal, setModal] = useState<null | 'edit' | 'asset' | 'contact'>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  useAiEntity(s ? { type: 'site', id: s.id, label: s.name } : null);
  if (isLoading || !s) return <Spinner />;

  const getBrief = async () => {
    setBriefing(true);
    setBriefErr(null);
    try {
      setBrief((await post('/ai/site-briefing', { site_id: s.id })).text);
    } catch (e) {
      setBriefErr(errorText(e));
    } finally {
      setBriefing(false);
    }
  };

  const openJobs = s.jobs.filter((j: any) => ['new', 'scheduled', 'in_progress', 'on_hold'].includes(j.status));
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-1 text-sm"><EntityLink to={`/customers/${s.customer_id}`}>{s.customer_name}</EntityLink>{s.end_client_name && <span className="text-muted"> · for {s.end_client_name}</span>}</div>
      <PageHeader
        title={s.name}
        subtitle={`${s.address ?? ''}, ${s.town ?? ''} ${s.postcode ?? ''} · ${s.building_type ?? ''}`}
        actions={
          <>
            <Button icon={<Sparkles className="size-4" />} loading={briefing} onClick={getBrief}>Site briefing</Button>
            {p.crmEdit && <Button onClick={() => setModal('edit')}>Edit site</Button>}
            {p.manageJobs && <Link to={`/jobs/new?site_id=${s.id}`}><Button variant="primary" icon={<ClipboardPlus className="size-4" />}>Log a call</Button></Link>}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.contract ? <Link to={`/contracts/${s.contract.id}`}><Badge tone="blue">{s.contract.ref} · {titleCase(s.contract.level).replace('Ppm', 'PPM')}{s.contract.ooh_cover ? ' · OOH cover' : ''}</Badge></Link> : <Badge tone="orange">No active contract</Badge>}
          {s.on_stop ? <Badge tone="red">Customer on stop</Badge> : null}
          <SiteAlerts site={s} />
        </div>
      </PageHeader>
      {(brief || briefErr) && (
        <Panel className="mb-5" title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-steel-600" /> Engineer briefing</span>} actions={<Button size="sm" variant="ghost" onClick={() => { setBrief(null); setBriefErr(null); }}>Close</Button>}>
          <ErrorNote error={briefErr} />
          {brief && <div className="text-sm"><Markdown text={brief} /></div>}
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'equipment', label: 'Equipment', count: s.assets.length },
            { id: 'jobs', label: 'Job history', count: s.jobs.length },
            { id: 'defects', label: 'Defects', count: s.defects.filter((d: any) => d.status !== 'resolved').length },
            { id: 'ppm', label: 'Planned maintenance', count: s.ppm_plans.length },
            { id: 'quotes', label: 'Quotes', count: s.quotes.length },
          ]} />
          {tab === 'equipment' && (
            <Panel bodyClass="p-0" title="Equipment register" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setModal('asset')}>Add equipment</Button>}>
              <Table rows={s.assets} rowLink={(a: any) => `/assets/${a.id}`} empty="No equipment recorded" columns={[
                { key: 't', label: 'Tag', render: (a: any) => <span className="num font-medium">{a.tag}</span> },
                { key: 'c', label: 'Equipment', render: (a: any) => (<div><div>{a.category}</div><div className="text-xs text-muted">{a.manufacturer} {a.model}</div></div>) },
                { key: 'l', label: 'Location', render: (a: any) => <span className="text-xs">{a.location}</span> },
                { key: 'r', label: 'Refrigerant', render: (a: any) => (a.refrigerant ? <span className={a.refrigerant === 'R22' ? 'text-xs font-medium text-scald' : 'text-xs'}>{a.refrigerant} · {a.refrigerant_kg}kg</span> : <span className="text-xs text-muted">—</span>) },
                { key: 'i', label: 'Installed', render: (a: any) => <span className="num text-xs">{a.install_date?.slice(0, 4)}</span> },
                { key: 's', label: 'Status', render: (a: any) => (<div className="flex flex-wrap gap-1">{a.status !== 'operational' ? <Badge tone={a.status === 'decommissioned' ? 'neutral' : 'orange'}>{titleCase(a.status)}</Badge> : <Badge tone="green">OK</Badge>}{['poor', 'end_of_life'].includes(a.condition) && <Badge tone="amber">{titleCase(a.condition)}</Badge>}<FgasBadge fgas={a.fgas} /></div>) },
              ]} />
            </Panel>
          )}
          {tab === 'jobs' && (
            <Panel bodyClass="p-0">
              <Table rows={s.jobs} rowLink={(j: any) => `/jobs/${j.id}`} columns={[
                { key: 'n', label: 'Job', render: (j: any) => <span className="num font-medium whitespace-nowrap">{j.job_no}</span> },
                { key: 'p', label: '', render: (j: any) => <PriorityBadge p={j.priority} /> },
                { key: 't', label: 'Title', render: (j: any) => (<div>{j.title}<div className="text-xs text-muted">{KIND_LABEL[j.kind]}{j.engineers ? ` · ${j.engineers}` : ''}</div></div>) },
                { key: 's', label: 'Status', render: (j: any) => <JobStatus s={j.status} hold={j.hold_reason} /> },
                { key: 'd', label: 'Logged', render: (j: any) => <span className="num text-xs">{date(j.created_at)}</span> },
              ]} />
            </Panel>
          )}
          {tab === 'defects' && (
            <Panel bodyClass="p-0">
              <Table rows={s.defects} empty="No defects recorded" columns={[
                { key: 's', label: 'Severity', render: (d: any) => <Badge tone={d.severity === 'unsafe' ? 'red' : d.severity === 'urgent' ? 'orange' : 'amber'}>{titleCase(d.severity)}</Badge> },
                { key: 'a', label: 'Equipment', render: (d: any) => <span className="num text-xs">{d.asset_tag}</span> },
                { key: 'd', label: 'Defect', render: (d: any) => (<div className="max-w-lg">{d.description}{d.recommendation && <div className="text-xs text-muted">→ {d.recommendation}</div>}</div>) },
                { key: 'j', label: 'Raised on', render: (d: any) => d.job_no && <EntityLink to={`/jobs/${d.job_id}`} className="num text-xs">{d.job_no}</EntityLink> },
                { key: 'st', label: 'Status', render: (d: any) => (<div className="text-xs">{titleCase(d.status)}{d.quote_no && <div><EntityLink to={`/quotes/${d.quote_id}`}>{d.quote_no}</EntityLink></div>}</div>) },
                { key: 'x', label: '', render: (d: any) => d.status === 'open' && p.quotes && <Button size="sm" onClick={() => ask(`Draft a quote for defect id ${d.id} at ${s.name} (${d.asset_tag ?? ''}: ${d.description}). Link the defect.`)}>Quote</Button> },
              ]} />
            </Panel>
          )}
          {tab === 'ppm' && (
            <Panel bodyClass="p-0">
              <Table rows={s.ppm_plans} empty="No planned maintenance at this site" columns={[
                { key: 'n', label: 'Plan', render: (x: any) => x.name },
                { key: 'f', label: 'Frequency', render: (x: any) => `Every ${x.frequency_months} month${x.frequency_months > 1 ? 's' : ''}` },
                { key: 'd', label: 'Next due', render: (x: any) => <span className="num">{date(x.next_due_on)}</span> },
                { key: 'c', label: 'Contract', render: (x: any) => <EntityLink to={`/contracts/${x.contract_id}`}>{x.contract_ref}</EntityLink> },
              ]} />
            </Panel>
          )}
          {tab === 'quotes' && (
            <Panel bodyClass="p-0">
              <Table rows={s.quotes} rowLink={(x: any) => `/quotes/${x.id}`} empty="No quotes" columns={[
                { key: 'n', label: 'Quote', render: (x: any) => <span className="num font-medium">{x.quote_no}</span> },
                { key: 't', label: 'Title', render: (x: any) => x.title },
                { key: 'v', label: 'Value', render: (x: any) => <span className="num">{money(x.total)}</span> },
                { key: 's', label: 'Status', render: (x: any) => <QuoteStatus s={x.status} /> },
              ]} />
            </Panel>
          )}
        </div>
        <aside className="space-y-4">
          <Panel title="Access & safety">
            <div className="space-y-2 text-sm">
              {s.opening_hours && <p><span className="text-muted">Hours:</span> {s.opening_hours}</p>}
              {s.access_notes && <p>{s.access_notes}</p>}
              {s.parking_notes && <p><span className="text-muted">Parking:</span> {s.parking_notes}</p>}
              {s.ooh_access && <p><span className="text-muted">Out of hours:</span> {s.ooh_access}</p>}
              {s.hazards && <p className="flex gap-1.5 text-[#9a4a16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {s.hazards}</p>}
            </div>
          </Panel>
          <Panel title="Contacts" actions={p.crmEdit && <Button size="sm" variant="ghost" onClick={() => setModal('contact')}>Add</Button>}>
            {s.contacts.map((c: any) => (
              <div key={c.id} className="border-b border-line py-2 text-sm last:border-0">
                <div className="font-medium">{c.name} <span className="font-normal text-muted">{c.job_title}</span></div>
                <div className="num text-xs text-muted">{[c.phone, c.mobile, c.email].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </Panel>
          {s.contract && (
            <Panel title="Contract cover">
              <KV cols={1} items={[
                ['Contract', <EntityLink to={`/contracts/${s.contract.id}`}>{s.contract.ref}</EntityLink>],
                ['Cover', `${titleCase(s.contract.level).replace('Ppm', 'PPM')}${s.contract.parts_included ? `, parts to ${money(s.contract.parts_limit)}` : ''}`],
                ['Out of hours', s.contract.ooh_cover ? 'Covered' : 'Not covered'],
                ['Ends', date(s.contract.ends_on)],
              ]} />
              {s.contract.sla.length > 0 && (
                <table className="mt-3 w-full text-xs">
                  <thead><tr className="text-left text-muted"><th className="py-1">Priority</th><th>Attend</th><th>Fix</th></tr></thead>
                  <tbody>{s.contract.sla.map((t: any) => <tr key={t.priority} className="border-t border-line"><td className="py-1">{t.priority}</td><td className="num">{t.response_hours}h {t.basis === '24x7' ? '24/7' : ''}</td><td className="num">{t.fix_hours ? `${t.fix_hours}h` : '—'}</td></tr>)}</tbody>
                </table>
              )}
            </Panel>
          )}
          {openJobs.length > 0 && (
            <Panel title="Open jobs">
              {openJobs.map((j: any) => <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center gap-2 py-1 text-sm hover:underline"><PriorityBadge p={j.priority} /><span className="truncate">{j.title}</span></Link>)}
            </Panel>
          )}
        </aside>
      </div>
      <FormModal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit site" fields={siteFields} initial={{ ...s, induction_required: !!s.induction_required, dbs_required: !!s.dbs_required, permit_to_work: !!s.permit_to_work }} onSubmit={(v) => patch(`/sites/${s.id}`, v).then(() => queryClient.invalidateQueries())} />
      <FormModal open={modal === 'asset'} onClose={() => setModal(null)} title="Add equipment" fields={assetFields(meta)} initial={{ status: 'operational' }} onSubmit={(v) => post('/assets', { ...v, site_id: s.id, tag: v.tag || undefined, status: v.status ?? undefined }).then(() => queryClient.invalidateQueries())} submitLabel="Add equipment" />
      <FormModal open={modal === 'contact'} onClose={() => setModal(null)} title="Add site contact" fields={contactFields([s])} initial={{ site_id: s.id }} onSubmit={(v) => post('/contacts', { ...v, customer_id: s.customer_id, roles: ['site'] }).then(() => queryClient.invalidateQueries())} />
    </div>
  );
}
