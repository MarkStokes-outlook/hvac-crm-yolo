import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApi } from '../lib/api';
import { Button, Input, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { JobStatus, KIND_LABEL, PriorityBadge, SlaHeat } from '../components/domain';
import { dateTime, shortDate } from '../lib/format';

const FILTERS = [
  ['status', 'Status', [['open', 'Open'], ['new', 'New'], ['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['on_hold', 'On hold'], ['completed', 'Completed'], ['closed', 'Closed'], ['cancelled', 'Cancelled'], ['', 'Any']]],
  ['kind', 'Type', [['', 'All types'], ...Object.entries(KIND_LABEL)]],
  ['priority', 'Priority', [['', 'All priorities'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'], ['P4', 'P4']]],
  ['sla', 'SLA', [['', 'Any SLA'], ['at_risk_or_breached', 'At risk or breached'], ['at_risk', 'At risk'], ['breached', 'Breached']]],
] as const;

export default function Jobs() {
  const [rawParams, setParams] = useSearchParams();
  const params = new URLSearchParams(rawParams);
  if (!params.has('status') && !params.has('sla') && !params.has('unscheduled')) params.set('status', 'open');
  const qs = new URLSearchParams([...params.entries()].filter(([, v]) => v !== ''));
  const { data, isLoading } = useApi<any[]>(`/jobs?${qs}`);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.set(k, '');
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Jobs"
        subtitle={data ? `${data.length} job${data.length === 1 ? '' : 's'}` : undefined}
        actions={
          <Link to="/jobs/new">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Log a call
            </Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search job no, title, site, postcode, PO…" defaultValue={params.get('search') ?? ''} onChange={(e) => set('search', e.target.value)} className="max-w-xs" />
        {FILTERS.map(([k, label, opts]) => (
          <Select key={k} aria-label={label} value={params.get(k) ?? ''} onChange={(e) => set(k, e.target.value)} className="w-auto">
            {opts.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        ))}
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={params.get('unscheduled') === '1'} onChange={(e) => set('unscheduled', e.target.checked ? '1' : '')} /> Unscheduled only
        </label>
      </div>
      <Panel bodyClass="p-0">
        {isLoading ? (
          <Spinner />
        ) : (
          <Table
            rows={data ?? []}
            rowLink={(j: any) => `/jobs/${j.id}`}
            empty="No jobs match these filters"
            columns={[
              { key: 'no', label: 'Job', render: (j: any) => <span className="num font-medium whitespace-nowrap">{j.job_no}</span> },
              { key: 'p', label: 'Pri', render: (j: any) => <PriorityBadge p={j.priority} /> },
              { key: 't', label: 'Issue', render: (j: any) => (<div className="min-w-[220px]"><div>{j.title}</div><div className="text-xs text-muted">{j.customer_name} · {j.site_name} {j.site_postcode}</div></div>) },
              { key: 'k', label: 'Type', render: (j: any) => <span className="text-xs">{KIND_LABEL[j.kind]}{j.contract_ref ? <div className="text-muted">{j.contract_ref}</div> : null}</span> },
              { key: 's', label: 'Status', render: (j: any) => <JobStatus s={j.status} hold={j.hold_reason} /> },
              { key: 'v', label: 'Next visit', render: (j: any) => (j.next_visit_at ? <div className="text-xs"><div className="num">{dateTime(j.next_visit_at)}</div><div className="text-muted">{j.engineers}</div></div> : j.due_on ? <span className="text-xs text-muted">Due {shortDate(j.due_on)}</span> : <span className="text-xs text-muted">—</span>) },
              { key: 'sla', label: 'SLA', render: (j: any) => <SlaHeat job={j} /> },
              { key: 'c', label: 'Logged', render: (j: any) => <span className="num text-xs text-muted">{shortDate(j.created_at)}</span> },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
