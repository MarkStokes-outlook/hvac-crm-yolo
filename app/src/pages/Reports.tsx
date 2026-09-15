import { useState } from 'react';
import { useApi } from '../lib/api';
import { PageHeader, Panel, Select, Spinner, Stat, Table } from '../components/ui';
import { EntityLink } from '../components/domain';
import { money, shortDate } from '../lib/format';

export default function Reports() {
  const [days, setDays] = useState(90);
  const { data: k, isLoading } = useApi<any>(`/reports/kpis?days=${days}`);
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
  const tone = (v: number | null, good: number) => (v == null ? undefined : v >= good ? 'ok' : v >= good - 10 ? 'hot' : 'scald') as any;
  const maxWeek = Math.max(1, ...(k?.jobs_by_week ?? []).map((w: any) => w.jobs));

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Performance"
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
          </Select>
        }
      />
      {isLoading || !k ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Attended within SLA" value={pct(k.response_sla_pct)} tone={tone(k.response_sla_pct, 95)} sub={`${k.reactive_jobs} reactive jobs`} />
            <Stat label="Fixed within SLA" value={pct(k.fix_sla_pct)} tone={tone(k.fix_sla_pct, 90)} />
            <Stat label="First-time fix" value={pct(k.first_time_fix_pct)} tone={tone(k.first_time_fix_pct, 80)} sub={`${k.recalls} recall${k.recalls === 1 ? '' : 's'}`} />
            <Stat label="PPM completed on time" value={pct(k.ppm_on_time_pct)} tone={tone(k.ppm_on_time_pct, 95)} sub={`${k.ppm_completed} of ${k.ppm_due} due`} />
            <Stat label="Quote win rate" value={pct(k.quote_win_pct)} sub={`${k.quotes_won} won · ${k.quotes_lost} lost`} />
            <Stat label="Quotes won" value={money(k.quotes_won_value)} tone="ok" />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Jobs logged per week">
              <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Jobs per week bar chart">
                {k.jobs_by_week.map((w: any) => (
                  <div key={w.week} className="group flex flex-1 flex-col items-center gap-1" title={`w/c ${shortDate(w.week_start)}: ${w.jobs} jobs (${w.reactive} reactive, ${w.ppm} PPM)`}>
                    <div className="num text-[10px] text-muted opacity-0 group-hover:opacity-100">{w.jobs}</div>
                    <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${(w.jobs / maxWeek) * 150}px` }}>
                      <div className="bg-hot" style={{ height: `${(w.reactive / w.jobs) * 100}%` }} />
                      <div className="bg-cool" style={{ height: `${(w.ppm / w.jobs) * 100}%` }} />
                      <div className="flex-1 bg-line-strong" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-hot" /> Reactive</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-cool" /> PPM</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-line-strong" /> Other</span>
              </div>
            </Panel>
            <Panel title="Sites with most breakdowns" bodyClass="p-0">
              <Table rows={k.top_fault_sites} dense columns={[
                { key: 's', label: 'Site', render: (s: any) => (<div><EntityLink to={`/sites/${s.id}`}>{s.name}</EntityLink><div className="text-xs text-muted">{s.customer_name}</div></div>) },
                { key: 'n', label: 'Reactive jobs', render: (s: any) => <span className="num">{s.reactive_jobs}</span>, className: 'text-right' },
              ]} />
            </Panel>
          </div>
          <Panel title="Engineers" bodyClass="p-0">
            <Table rows={k.engineers} columns={[
              { key: 'n', label: 'Engineer', render: (e: any) => <EntityLink to={`/engineers/${e.id}`}>{e.name}</EntityLink> },
              { key: 'v', label: 'Visits', render: (e: any) => <span className="num">{e.visits}</span>, className: 'text-right' },
              { key: 'h', label: 'Hours on site', render: (e: any) => <span className="num">{e.hours_on_site ?? 0}</span>, className: 'text-right' },
              { key: 'c', label: 'Completed first time', render: (e: any) => <span className="num">{e.visits ? `${Math.round((e.completed_outcomes / e.visits) * 100)}%` : '—'}</span>, className: 'text-right' },
            ]} />
          </Panel>
        </div>
      )}
    </div>
  );
}
