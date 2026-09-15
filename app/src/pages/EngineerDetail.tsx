import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { del, post, queryClient, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { useAiEntity } from '../components/AiPanel';
import { Badge, Button, KV, PageHeader, Panel, Spinner, Table } from '../components/ui';
import { PriorityBadge, Skills, VisitStatus } from '../components/domain';
import { FormModal } from '../components/FormModal';
import { date, dateTime, time, titleCase } from '../lib/format';

export default function EngineerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: e, isLoading } = useApi<any>(`/engineers/${id}`);
  const van = useApi<any>(e?.van_location_id ? `/stock/locations/${e.van_location_id}` : null);
  const [absence, setAbsence] = useState(false);
  useAiEntity(e ? { type: 'engineer', id: e.id, label: e.name } : null);
  if (isLoading || !e) return <Spinner />;
  const canEdit = perms(user).schedule;

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title={e.name} subtitle={e.kind === 'subcontractor' ? `Subcontractor · ${e.company}` : `${titleCase(e.grade)} engineer · ${titleCase(e.team)} team`} actions={canEdit && <Button onClick={() => setAbsence(true)}>Add absence</Button>} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title="Upcoming visits" bodyClass="p-0">
            <Table rows={e.upcoming} rowLink={(v: any) => `/jobs/${v.job_id}`} empty="Nothing booked" columns={[
              { key: 'd', label: 'When', render: (v: any) => <span className="num text-xs">{dateTime(v.starts_at)}–{time(v.ends_at)}</span> },
              { key: 'j', label: 'Job', render: (v: any) => (<div><span className="num text-muted">{v.job_no}</span> {v.title}<div className="text-xs text-muted">{v.site_name} {v.postcode}</div></div>) },
              { key: 'p', label: '', render: (v: any) => <PriorityBadge p={v.priority} /> },
              { key: 's', label: 'Status', render: (v: any) => <VisitStatus s={v.status} /> },
            ]} />
          </Panel>
          <Panel title="Recent work" bodyClass="p-0">
            <Table rows={e.recent} rowLink={(v: any) => `/jobs/${v.job_id}`} dense columns={[
              { key: 'd', label: 'Date', render: (v: any) => <span className="num text-xs">{date(v.starts_at)}</span> },
              { key: 'j', label: 'Job', render: (v: any) => (<div><span className="num text-muted">{v.job_no}</span> {v.title}<div className="text-xs text-muted">{v.site_name}</div></div>) },
              { key: 'o', label: 'Outcome', render: (v: any) => <span className="text-xs">{titleCase(v.outcome)}</span> },
            ]} />
          </Panel>
          {van.data && (
            <Panel title={`Van stock — ${van.data.name}`} bodyClass="p-0">
              <Table rows={van.data.items} dense columns={[
                { key: 'n', label: 'Part', render: (i: any) => (<div>{i.name}<div className="num text-xs text-muted">{i.sku}</div></div>) },
                { key: 'q', label: 'Qty', render: (i: any) => <span className={i.qty < i.min_qty ? 'num font-medium text-scald' : 'num'}>{i.qty}</span> },
                { key: 'm', label: 'Min / max', render: (i: any) => <span className="num text-xs text-muted">{i.min_qty} / {i.max_qty}</span> },
              ]} />
            </Panel>
          )}
        </div>
        <aside className="space-y-4">
          <Panel title="Details">
            <KV cols={1} items={[
              ['Phone', e.phone],
              ['Email', e.email],
              ['Home base', e.home_postcode],
              ['Van', e.van_reg],
              ['Working hours', `${e.day_start}–${e.day_end}`],
            ]} />
            {e.notes && <p className="mt-3 border-t border-line pt-2 text-sm">{e.notes}</p>}
          </Panel>
          <Panel title="Skills"><Skills skills={e.skills} /></Panel>
          <Panel title="Tickets & qualifications">
            {e.qualifications.map((q: any) => (
              <div key={q.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm last:border-0">
                <div>{q.name}<div className="num text-xs text-muted">{q.reference}</div></div>
                <Badge tone={q.state === 'expired' ? 'red' : q.state === 'expiring' ? 'amber' : 'green'}>{q.expires_on ? `${q.state === 'expired' ? 'Expired' : 'to'} ${date(q.expires_on)}` : 'No expiry'}</Badge>
              </div>
            ))}
          </Panel>
          <Panel title="Absence">
            {e.absences.length === 0 ? <div className="text-sm text-muted">None booked.</div> : e.absences.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between py-1 text-sm">
                <span>{titleCase(a.kind)} · {date(a.starts_at)}{date(a.ends_at) !== date(a.starts_at) ? ` – ${date(a.ends_at)}` : ''}</span>
                {canEdit && <button className="text-xs text-muted hover:text-scald" onClick={() => del(`/absences/${a.id}`).then(() => queryClient.invalidateQueries())}>Remove</button>}
              </div>
            ))}
          </Panel>
        </aside>
      </div>
      <FormModal
        open={absence}
        onClose={() => setAbsence(false)}
        title={`Absence — ${e.name}`}
        fields={[
          { name: 'kind', label: 'Type', type: 'select', required: true, options: [['holiday', 'Holiday'], ['sick', 'Sick'], ['training', 'Training'], ['other', 'Other']] },
          { name: 'from', label: 'From', type: 'date', required: true },
          { name: 'to', label: 'To (inclusive)', type: 'date', required: true },
          { name: 'notes', label: 'Notes', wide: true },
        ]}
        onSubmit={(v) => post(`/engineers/${e.id}/absences`, { kind: v.kind, starts_at: new Date(`${v.from}T00:00:00`).toISOString(), ends_at: new Date(`${v.to}T23:59:00`).toISOString(), notes: v.notes ?? undefined }).then(() => queryClient.invalidateQueries())}
      />
    </div>
  );
}
