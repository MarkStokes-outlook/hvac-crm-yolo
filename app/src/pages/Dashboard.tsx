import { Link } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import { useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAi } from '../components/AiPanel';
import { Badge, Button, Empty, PageHeader, Panel, Spinner, Stat, Table } from '../components/ui';
import { JobStatus, KIND_LABEL, PriorityBadge, SlaHeat, VisitStatus } from '../components/domain';
import { date, money, time, titleCase } from '../lib/format';

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useApi<any>('/dashboard', { refetchInterval: 60_000 });
  const { ask } = useAi();
  if (isLoading || !data) return <Spinner />;
  const c = data.counts;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const sales = user?.role === 'sales';

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={`${greeting}, ${user?.name.split(' ')[0]}`}
        subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={
          <>
            <Button icon={<Sparkles className="size-4" />} onClick={() => ask('What needs my attention right now? Prioritise SLA risks and unscheduled urgent work, and suggest what to do about each.')}>
              What needs attention?
            </Button>
            <Link to="/jobs/new">
              <Button variant="primary" icon={<Plus className="size-4" />}>
                Log a call
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="SLA breached" value={c.sla_breached} tone={c.sla_breached ? 'scald' : 'ok'} to="/jobs?sla=breached" sub="open reactive jobs" />
        <Stat label="SLA at risk" value={c.sla_at_risk} tone={c.sla_at_risk ? 'hot' : 'ok'} to="/jobs?sla=at_risk" sub="deadline close" />
        <Stat label="Unscheduled" value={c.unscheduled} tone={c.unscheduled ? 'hot' : 'cool'} to="/jobs?unscheduled=1" sub={`${c.p1_open} P1 open`} />
        <Stat label="Visits today" value={`${c.visits_completed_today}/${c.visits_today}`} to="/schedule" sub="done / booked" />
        <Stat label="On hold" value={c.on_hold} to="/jobs?status=on_hold" sub={`${c.awaiting_parts} awaiting parts`} />
        <Stat label="New in inbox" value={c.new_enquiries} tone={c.new_enquiries ? 'hot' : 'cool'} to="/inbox" sub="emails & voicemails" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {!sales && (
            <Panel title="SLA watch" actions={<Link to="/jobs?sla=at_risk_or_breached" className="text-sm text-steel-600 hover:underline">All</Link>} bodyClass="p-0">
              <JobRows rows={data.sla_risk} empty="No reactive jobs at risk. Nice." />
            </Panel>
          )}
          {!sales && (
            <Panel title="Waiting to be scheduled" actions={<Link to="/schedule" className="text-sm text-steel-600 hover:underline">Open schedule</Link>} bodyClass="p-0">
              <JobRows rows={data.unscheduled} empty="Everything is booked in." />
            </Panel>
          )}
          <Panel title="Today's visits" bodyClass="p-0">
            <Table
              dense
              rows={data.today_visits}
              rowLink={(v: any) => `/jobs/${v.job_id}`}
              empty="No visits booked today"
              columns={[
                { key: 't', label: 'Time', render: (v: any) => <span className="num">{time(v.starts_at)}</span> },
                { key: 'e', label: 'Engineer', render: (v: any) => v.engineer_name },
                { key: 'j', label: 'Job', render: (v: any) => (<div><span className="num text-muted">{v.job_no}</span> {v.title}<div className="text-xs text-muted">{v.site_name}</div></div>) },
                { key: 'k', label: 'Type', render: (v: any) => <span className="text-xs text-muted">{KIND_LABEL[v.kind]}</span> },
                { key: 's', label: 'Status', render: (v: any) => <VisitStatus s={v.status} /> },
              ]}
            />
          </Panel>
        </div>

        <div className="space-y-5">
          {data.engineers_out.length > 0 && (
            <Panel title="Out today">
              <ul className="space-y-1 text-sm">
                {data.engineers_out.map((e: any) => (
                  <li key={e.id} className="flex justify-between">
                    <Link to={`/engineers/${e.id}`} className="hover:underline">{e.name}</Link>
                    <Badge>{titleCase(e.kind)}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="On hold" bodyClass="p-0">
            {data.on_hold.length ? (
              <ul className="divide-y divide-line">
                {data.on_hold.map((j: any) => (
                  <li key={j.id} className="px-4 py-2.5">
                    <Link to={`/jobs/${j.id}`} className="text-sm hover:underline">
                      <span className="num text-muted">{j.job_no}</span> {j.title}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <JobStatus s={j.status} hold={j.hold_reason} /> {j.site_name}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nothing on hold" />
            )}
          </Panel>
          <Panel title="Quotes" actions={<Link to="/quotes" className="text-sm text-steel-600 hover:underline">Pipeline</Link>}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted">Awaiting decision</div>
                <div className="num text-xl font-semibold text-navy-900">{money(data.quotes.sent_value)}</div>
                <div className="text-xs text-muted">{data.quotes.sent_count} sent</div>
              </div>
              <div>
                <div className="text-xs text-muted">Won (90 days)</div>
                <div className="num text-xl font-semibold text-ok">{money(data.quotes.won_value_90d)}</div>
                <div className="text-xs text-muted">{data.quotes.won_90d} won · {data.quotes.lost_90d} lost</div>
              </div>
            </div>
            {data.quote_follow_ups.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-1 text-xs text-muted">Follow-ups due</div>
                {data.quote_follow_ups.map((q: any) => (
                  <Link key={q.id} to={`/quotes/${q.id}`} className="flex justify-between gap-2 py-1 text-sm hover:underline">
                    <span className="truncate">{q.customer_name} — {q.title}</span>
                    <span className="num shrink-0 text-muted">{money(q.total)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
          {data.contract_renewals.length > 0 && (
            <Panel title="Contract renewals (90 days)">
              {data.contract_renewals.map((ct: any) => (
                <Link key={ct.id} to={`/contracts/${ct.id}`} className="flex justify-between gap-2 py-1 text-sm hover:underline">
                  <span className="truncate">{ct.customer_name}</span>
                  <span className="num shrink-0 text-muted">{date(ct.ends_on)}</span>
                </Link>
              ))}
            </Panel>
          )}
          {data.tasks.length > 0 && (
            <Panel title="My tasks">
              {data.tasks.map((t: any) => (
                <Link key={t.id} to={t.customer_id ? `/customers/${t.customer_id}` : '#'} className="block py-1 text-sm hover:underline">
                  {t.subject} <span className="text-xs text-muted">· due {date(t.due_on)}</span>
                </Link>
              ))}
            </Panel>
          )}
          <Panel title="Other">
            <div className="space-y-1.5 text-sm">
              <Link to="/jobs?status=completed" className="flex justify-between hover:underline"><span>Completed, awaiting review</span><span className="num">{c.completed_to_review}</span></Link>
              <Link to="/ppm" className="flex justify-between hover:underline"><span>PPM overdue</span><span className="num">{c.ppm_overdue}</span></Link>
              <Link to="/stock" className="flex justify-between hover:underline"><span>Stock lines below minimum</span><span className="num">{data.low_stock_count}</span></Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function JobRows({ rows, empty }: { rows: any[]; empty: string }) {
  return (
    <Table
      rows={rows}
      empty={empty}
      rowLink={(j: any) => `/jobs/${j.id}`}
      columns={[
        { key: 'no', label: 'Job', render: (j: any) => <span className="num font-medium whitespace-nowrap">{j.job_no}</span> },
        { key: 'p', label: '', render: (j: any) => <PriorityBadge p={j.priority} /> },
        { key: 't', label: 'Issue', render: (j: any) => (<div className="min-w-[200px]"><div className="text-ink">{j.title}</div><div className="text-xs text-muted">{j.customer_name} · {j.site_name}</div></div>) },
        { key: 's', label: 'Status', render: (j: any) => <JobStatus s={j.status} hold={j.hold_reason} /> },
        { key: 'sla', label: 'SLA', render: (j: any) => <SlaHeat job={j} /> },
      ]}
    />
  );
}
