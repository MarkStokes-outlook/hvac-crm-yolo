import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { errorText, post, useAction, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Badge, Button, ErrorNote, Input, PageHeader, Panel, Spinner, Table } from '../components/ui';
import { EntityLink, JobStatus } from '../components/domain';
import { addDays, date, dateTime, ymd } from '../lib/format';

export default function Ppm() {
  const { user } = useAuth();
  const [until, setUntil] = useState(ymd(addDays(new Date(), 30)));
  const plans = useApi<any[]>(`/ppm/plans?due_before=${until}`);
  const outstanding = useApi<any[]>('/ppm/outstanding');
  const [result, setResult] = useState<any>(null);
  const generate = useAction(() => post('/ppm/generate', { until }), setResult);
  const today = ymd(new Date());

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Planned maintenance"
        subtitle="Contract PPM plans become jobs when they fall due, then get booked like any other work"
        actions={
          perms(user).manageJobs && (
            <>
              <label className="flex items-center gap-2 text-sm">Due by <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-40" /></label>
              <Button variant="primary" icon={<CalendarPlus className="size-4" />} loading={generate.isPending} onClick={() => generate.mutate(undefined)}>Create PPM jobs</Button>
            </>
          )
        }
      />
      <ErrorNote error={generate.error && errorText(generate.error)} />
      {result && (
        <div className="mb-4 rounded-md border border-ok/30 bg-ok-50 px-4 py-3 text-sm text-ok">
          {result.created.length ? `Created ${result.created.length} PPM job${result.created.length > 1 ? 's' : ''}: ${result.created.map((c: any) => c.job_no).join(', ')}. They're now in the unscheduled list on the schedule.` : 'No new jobs needed — everything due already has a job.'}
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title={`Plans due by ${date(until)}`} bodyClass="p-0">
          {plans.isLoading ? <Spinner /> : (
            <Table rows={plans.data ?? []} empty="Nothing due in this window" columns={[
              { key: 'd', label: 'Due', render: (p: any) => <span className={p.next_due_on < today ? 'num font-medium text-scald' : 'num'}>{date(p.next_due_on)}</span> },
              { key: 'n', label: 'Plan', render: (p: any) => (<div><div>{p.name}</div><div className="text-xs text-muted"><EntityLink to={`/sites/${p.site_id}`}>{p.site_name}</EntityLink> · {p.customer_name}</div></div>) },
              { key: 'c', label: 'Contract', render: (p: any) => <EntityLink to={`/contracts/${p.contract_id}`} className="num text-xs">{p.contract_ref}</EntityLink> },
              { key: 'j', label: 'Job', render: (p: any) => (p.generated_job_id ? <EntityLink to={`/jobs/${p.generated_job_id}`} className="num text-xs">{p.generated_job_no}</EntityLink> : <Badge tone="amber">Not created</Badge>) },
            ]} />
          )}
        </Panel>
        <Panel title="PPM jobs not yet complete" bodyClass="p-0">
          {outstanding.isLoading ? <Spinner /> : (
            <Table rows={outstanding.data ?? []} rowLink={(j: any) => `/jobs/${j.id}`} empty="All PPM complete" columns={[
              { key: 'n', label: 'Job', render: (j: any) => <span className="num">{j.job_no}</span> },
              { key: 't', label: 'Visit', render: (j: any) => (<div><div>{j.title}</div><div className="text-xs text-muted">{j.site_name}</div></div>) },
              { key: 'd', label: 'Due', render: (j: any) => <span className={j.due_on < today ? 'num text-xs font-medium text-scald' : 'num text-xs'}>{date(j.due_on)}</span> },
              { key: 'v', label: 'Booked', render: (j: any) => (j.next_visit_at ? <span className="num text-xs">{dateTime(j.next_visit_at)}</span> : <Badge tone="orange">Unbooked</Badge>) },
              { key: 's', label: 'Status', render: (j: any) => <JobStatus s={j.status} /> },
            ]} />
          )}
        </Panel>
      </div>
    </div>
  );
}
