import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardPlus, Sparkles } from 'lucide-react';
import { patch, queryClient, useApi } from '../lib/api';
import { perms, useAuth, useMeta } from '../lib/auth';
import { useAi, useAiEntity } from '../components/AiPanel';
import { Badge, Button, KV, PageHeader, Panel, Spinner, Table } from '../components/ui';
import { EntityLink, FgasBadge, KIND_LABEL } from '../components/domain';
import { FormModal } from '../components/FormModal';
import { assetFields } from './SiteDetail';
import { date, titleCase } from '../lib/format';

export default function AssetDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  const { ask } = useAi();
  const { data: a, isLoading } = useApi<any>(`/assets/${id}`);
  const [edit, setEdit] = useState(false);
  useAiEntity(a ? { type: 'asset', id: a.id, label: `${a.tag} ${a.category} at ${a.site_name}` } : null);
  if (isLoading || !a) return <Spinner />;
  const age = a.install_date ? new Date().getFullYear() - Number(a.install_date.slice(0, 4)) : null;

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="mb-1 text-sm"><EntityLink to={`/customers/${a.customer_id}`}>{a.customer_name}</EntityLink> / <EntityLink to={`/sites/${a.site_id}`}>{a.site_name}</EntityLink></div>
      <PageHeader
        title={<><span className="num">{a.tag}</span> {a.category}</>}
        subtitle={`${a.manufacturer ?? ''} ${a.model ?? ''} · ${a.location ?? ''}`}
        actions={
          <>
            <Button icon={<Sparkles className="size-4" />} onClick={() => ask(`Review the history of equipment ${a.tag} at ${a.site_name} (asset id ${a.id}). Are there recurring faults? Is it worth repairing or should we recommend replacement? Consider age, refrigerant and costs.`)}>Repair or replace?</Button>
            <Button onClick={() => setEdit(true)}>Edit</Button>
            {perms(user).manageJobs && <Link to={`/jobs/new?site_id=${a.site_id}&assets=${a.id}`}><Button variant="primary" icon={<ClipboardPlus className="size-4" />}>Log a fault</Button></Link>}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={a.status === 'operational' ? 'green' : 'orange'}>{titleCase(a.status)}</Badge>
          {a.condition && <Badge tone={['poor', 'end_of_life'].includes(a.condition) ? 'amber' : 'neutral'}>Condition: {titleCase(a.condition)}</Badge>}
          <FgasBadge fgas={a.fgas} />
          {a.refrigerant === 'R22' && <Badge tone="red">R22 — replacement required</Badge>}
          {a.warranty_expires && a.warranty_expires >= new Date().toISOString().slice(0, 10) && <Badge tone="blue">Under warranty to {date(a.warranty_expires)}</Badge>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title="Service history" bodyClass="p-0">
            {a.jobs.length === 0 ? <div className="p-4 text-sm text-muted">No jobs recorded against this unit.</div> : (
              <ol className="divide-y divide-line">
                {a.jobs.map((j: any) => (
                  <li key={j.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="num text-muted">{date(j.completed_at ?? j.created_at)}</span>
                      <Link to={`/jobs/${j.id}`} className="num font-medium text-steel-600 hover:underline">{j.job_no}</Link>
                      <Badge>{KIND_LABEL[j.kind]}</Badge>
                      <span>{j.title}</span>
                      <span className="text-xs text-muted">{j.engineers}</span>
                    </div>
                    {(j.work_summaries || j.resolution) && <div className="mt-1 text-sm text-muted">{j.work_summaries ?? j.resolution}</div>}
                    {j.cause && <div className="mt-0.5 text-xs text-muted">Cause: {j.cause}</div>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          {a.refrigerant && (
            <Panel title="Refrigerant log" bodyClass="p-0">
              <Table rows={a.refrigerant_logs} dense empty="No refrigerant records" columns={[
                { key: 'd', label: 'Date', render: (r: any) => <span className="num text-xs">{date(r.logged_on)}</span> },
                { key: 'a', label: 'Action', render: (r: any) => titleCase(r.action) },
                { key: 'q', label: 'Qty', render: (r: any) => <span className="num">{r.qty_kg} kg</span> },
                { key: 'l', label: 'Leak', render: (r: any) => (r.leak_found ? <Badge tone="red">Yes</Badge> : 'No') },
                { key: 'e', label: 'Engineer', render: (r: any) => <span className="text-xs">{r.engineer_name}</span> },
                { key: 'j', label: 'Job', render: (r: any) => r.job_id && <EntityLink to={`/jobs/${r.job_id}`} className="num text-xs">{r.job_no}</EntityLink> },
              ]} />
            </Panel>
          )}
          {a.defects.length > 0 && (
            <Panel title="Defects" bodyClass="p-0">
              <Table rows={a.defects} columns={[
                { key: 's', label: 'Severity', render: (d: any) => <Badge tone={d.severity === 'urgent' || d.severity === 'unsafe' ? 'orange' : 'amber'}>{titleCase(d.severity)}</Badge> },
                { key: 'd', label: 'Defect', render: (d: any) => (<div>{d.description}{d.recommendation && <div className="text-xs text-muted">→ {d.recommendation}</div>}</div>) },
                { key: 'st', label: 'Status', render: (d: any) => (<span className="text-xs">{titleCase(d.status)} {d.quote_no && <EntityLink to={`/quotes/${d.quote_id}`}>{d.quote_no}</EntityLink>}</span>) },
              ]} />
            </Panel>
          )}
        </div>
        <aside className="space-y-4">
          <Panel title="Details">
            <KV cols={1} items={[
              ['Serial number', <span className="num">{a.serial_number}</span>],
              ['Installed', a.install_date ? `${date(a.install_date)} (${age} yrs)${a.installed_by_us ? ' by Frostline' : ''}` : '—'],
              ['Warranty', a.warranty_expires ? date(a.warranty_expires) : '—'],
              ['Capacity', a.capacity_kw ? `${a.capacity_kw} kW` : '—'],
              ['Fuel', a.fuel],
              ['Part of', a.parent_tag ? <EntityLink to={`/assets/${a.parent_asset_id}`}>{a.parent_tag}</EntityLink> : undefined],
              ['Last serviced', date(a.last_serviced_on)],
            ]} />
            {a.children.length > 0 && <div className="mt-3 border-t border-line pt-2 text-sm"><div className="text-xs text-muted">Connected units</div>{a.children.map((c: any) => <div key={c.id}><EntityLink to={`/assets/${c.id}`}>{c.tag}</EntityLink> {c.category} <span className="text-muted">{c.location}</span></div>)}</div>}
            {a.notes && <p className="mt-3 border-t border-line pt-2 text-sm">{a.notes}</p>}
          </Panel>
          {a.refrigerant && (
            <Panel title="F-Gas">
              <KV cols={1} items={[
                ['Refrigerant', `${a.refrigerant} · ${a.refrigerant_kg ?? '?'} kg`],
                ['GWP', a.fgas.gwp],
                ['CO₂ equivalent', a.fgas.co2e_tonnes != null ? `${a.fgas.co2e_tonnes} tonnes` : '—'],
                ['Leak check interval', a.fgas.interval_months ? `Every ${a.fgas.interval_months} months${a.leak_detection ? ' (leak detection fitted)' : ''}` : 'Not required (under 5t CO₂e)'],
                ['Last leak check', date(a.last_leak_check_on)],
                ['Next due', a.fgas.next_due_on ? date(a.fgas.next_due_on) : '—'],
              ]} />
              {a.fgas.note && <p className="mt-2 text-xs text-scald">{a.fgas.note}</p>}
            </Panel>
          )}
          {a.parts_used.length > 0 && (
            <Panel title="Parts fitted">
              {a.parts_used.map((p: any, i: number) => <div key={i} className="flex justify-between gap-2 py-0.5 text-sm"><span className="truncate">{p.qty} × {p.description}</span><span className="num shrink-0 text-xs text-muted">{date(p.created_at)}</span></div>)}
            </Panel>
          )}
        </aside>
      </div>
      <FormModal open={edit} onClose={() => setEdit(false)} title={`Edit ${a.tag}`} fields={assetFields(meta)} initial={{ ...a, leak_detection: !!a.leak_detection, installed_by_us: !!a.installed_by_us }} onSubmit={(v) => patch(`/assets/${a.id}`, { ...v, tag: v.tag || a.tag, category: v.category || a.category, status: v.status || a.status }).then(() => queryClient.invalidateQueries())} />
    </div>
  );
}
