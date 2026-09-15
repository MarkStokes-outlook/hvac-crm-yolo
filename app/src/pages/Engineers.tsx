import { useApi } from '../lib/api';
import { Badge, PageHeader, Panel, Spinner, Table } from '../components/ui';
import { Skills } from '../components/domain';
import { titleCase } from '../lib/format';

export default function Engineers() {
  const { data, isLoading } = useApi<any[]>('/engineers');
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Engineers" subtitle="Skills, tickets and vans for employed engineers and approved subcontractors" />
      <Panel bodyClass="p-0">
        {isLoading ? <Spinner /> : (
          <Table rows={data ?? []} rowLink={(e: any) => `/engineers/${e.id}`} columns={[
            { key: 'n', label: 'Engineer', render: (e: any) => (<div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: e.colour }} /><div><div className="font-medium">{e.name}</div><div className="text-xs text-muted">{e.kind === 'subcontractor' ? e.company : `${titleCase(e.grade)} · ${titleCase(e.team)}`}</div></div></div>) },
            { key: 's', label: 'Skills', render: (e: any) => <Skills skills={e.skills} /> },
            { key: 'q', label: 'Tickets', render: (e: any) => (<div className="flex flex-wrap gap-1">{e.qualifications.map((q: any) => <Badge key={q.id} tone={q.state === 'expired' ? 'red' : q.state === 'expiring' ? 'amber' : 'neutral'} title={q.expires_on ? `Expires ${q.expires_on}` : undefined}>{q.code.replace('_', ' ')}</Badge>)}</div>) },
            { key: 'h', label: 'Base', render: (e: any) => <span className="num text-xs">{e.home_postcode}</span> },
            { key: 'v', label: 'Van', render: (e: any) => <span className="num text-xs">{e.van_reg ?? '—'}</span> },
          ]} />
        )}
      </Panel>
    </div>
  );
}
