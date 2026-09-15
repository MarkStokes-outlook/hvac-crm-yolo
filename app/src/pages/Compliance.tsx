import { useApi } from '../lib/api';
import { Badge, PageHeader, Panel, Spinner, Table } from '../components/ui';
import { EntityLink, FgasBadge } from '../components/domain';
import { date, titleCase } from '../lib/format';

export default function Compliance() {
  const { data, isLoading } = useApi<any>('/reports/compliance');
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Compliance" subtitle="F-Gas leak checks, engineer tickets, warranties and open safety defects" />
      <div className="space-y-5">
        <Panel title={`F-Gas leak checks due or overdue (${data.fgas.length})`} bodyClass="p-0">
          <Table rows={data.fgas} rowLink={(a: any) => `/assets/${a.id}`} empty="All leak checks in date" columns={[
            { key: 't', label: 'Equipment', render: (a: any) => (<div><span className="num font-medium">{a.tag}</span> {a.category}<div className="text-xs text-muted">{a.manufacturer} {a.model}</div></div>) },
            { key: 's', label: 'Site', render: (a: any) => (<div className="text-xs"><div>{a.site_name}</div><div className="text-muted">{a.customer_name}</div></div>) },
            { key: 'r', label: 'Charge', render: (a: any) => <span className="num text-xs">{a.refrigerant} {a.refrigerant_kg}kg · {a.fgas.co2e_tonnes}t CO₂e</span> },
            { key: 'i', label: 'Interval', render: (a: any) => <span className="text-xs">{a.fgas.interval_months ? `${a.fgas.interval_months} months` : '—'}</span> },
            { key: 'l', label: 'Last check', render: (a: any) => <span className="num text-xs">{date(a.last_leak_check_on)}</span> },
            { key: 'n', label: 'Due', render: (a: any) => <span className="num text-xs">{date(a.fgas.next_due_on)}</span> },
            { key: 'st', label: '', render: (a: any) => (<div className="flex flex-wrap gap-1"><FgasBadge fgas={a.fgas} />{a.refrigerant === 'R22' && <Badge tone="red">R22</Badge>}</div>) },
          ]} />
        </Panel>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Engineer tickets expired or expiring" bodyClass="p-0">
            <Table rows={data.qualifications} rowLink={(q: any) => `/engineers/${q.engineer_id}`} empty="All tickets in date" columns={[
              { key: 'e', label: 'Engineer', render: (q: any) => q.engineer_name },
              { key: 'q', label: 'Ticket', render: (q: any) => q.name },
              { key: 'x', label: 'Expires', render: (q: any) => <Badge tone={q.state === 'expired' ? 'red' : 'amber'}>{date(q.expires_on)}</Badge> },
            ]} />
          </Panel>
          <Panel title="Warranties ending in 90 days" bodyClass="p-0">
            <Table rows={data.warranties} rowLink={(a: any) => `/assets/${a.id}`} empty="None" columns={[
              { key: 't', label: 'Equipment', render: (a: any) => <span><span className="num">{a.tag}</span> {a.manufacturer} {a.model}</span> },
              { key: 's', label: 'Site', render: (a: any) => <span className="text-xs">{a.site_name}</span> },
              { key: 'w', label: 'Ends', render: (a: any) => <span className="num text-xs">{date(a.warranty_expires)}</span> },
            ]} />
          </Panel>
        </div>
        <Panel title="Open urgent & unsafe defects" bodyClass="p-0">
          <Table rows={data.open_safety_defects} empty="None open" columns={[
            { key: 's', label: 'Severity', render: (d: any) => <Badge tone={d.severity === 'unsafe' ? 'red' : 'orange'}>{titleCase(d.severity)}</Badge> },
            { key: 'site', label: 'Site', render: (d: any) => <EntityLink to={`/sites/${d.site_id}`}>{d.site_name}</EntityLink> },
            { key: 'a', label: 'Equipment', render: (d: any) => <span className="num text-xs">{d.asset_tag}</span> },
            { key: 'd', label: 'Defect', render: (d: any) => <span className="text-sm">{d.description}</span> },
            { key: 'j', label: 'Job', render: (d: any) => d.job_no && <EntityLink to={`/jobs/${d.job_id}`} className="num text-xs">{d.job_no}</EntityLink> },
            { key: 'st', label: 'Status', render: (d: any) => <span className="text-xs">{titleCase(d.status)}</span> },
          ]} />
        </Panel>
      </div>
    </div>
  );
}
