import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, GripVertical, Phone } from 'lucide-react';
import { errorText, patch, post, useAction, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Badge, Button, ErrorNote, Modal, PageHeader, Panel, Select, Spinner, cx } from '../components/ui';
import { KIND_LABEL, PriorityBadge, SKILL_SHORT, SlaHeat, VisitStatus } from '../components/domain';
import { addDays, dateTime, shortDate, time, ymd } from '../lib/format';

const DAY_START = 7;
const DAY_END = 19;
const HOURS = DAY_END - DAY_START;

const kindColour: Record<string, string> = {
  reactive: 'bg-hot-50 border-hot/50',
  recall: 'bg-scald-50 border-scald/40',
  ppm: 'bg-steel-50 border-steel-500/40',
  installation: 'bg-[#eef0fb] border-[#6b74c9]/40',
  quoted: 'bg-[#eef0fb] border-[#6b74c9]/40',
  remedial: 'bg-warn-50 border-warm/50',
  warranty: 'bg-ok-50 border-ok/30',
  survey: 'bg-paper border-line-strong',
};

export default function Schedule() {
  const { user } = useAuth();
  const canEdit = perms(user).schedule;
  const [day, setDay] = useState(() => {
    const d = new Date();
    if (d.getDay() === 6) return addDays(d, 2);
    if (d.getDay() === 0) return addDays(d, 1);
    return d;
  });
  const [view, setView] = useState<'day' | 'week'>('day');
  const [team, setTeam] = useState('all');
  const weekStart = addDays(day, -((day.getDay() + 6) % 7));
  const from = view === 'day' ? ymd(day) : ymd(weekStart);
  const to = view === 'day' ? ymd(day) : ymd(addDays(weekStart, 4));
  const board = useApi<any>(`/schedule?from=${from}&to=${to}`, { refetchInterval: 60_000 });
  const unscheduled = useApi<any[]>('/jobs?unscheduled=1&limit=100');
  const [selected, setSelected] = useState<any>(null);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<any>(null);

  const book = useAction((b: any) => post('/visits', b), () => setPendingDrop(null));
  const move = useAction(({ id, ...b }: any) => patch(`/visits/${id}`, b), () => setPendingDrop(null));

  const engineers = useMemo(() => (board.data?.engineers ?? []).filter((e: any) => team === 'all' || (team === 'sub' ? e.kind === 'subcontractor' : e.team === team && e.kind === 'employee')), [board.data, team]);

  const onDrop = (engineerId: number, dayStr: string, hour: number, data: string) => {
    if (!canEdit) return;
    const payload = JSON.parse(data);
    const start = new Date(`${dayStr}T00:00:00`);
    start.setHours(Math.floor(hour), Math.round((hour % 1) * 60 / 15) * 15, 0, 0);
    setDropErr(null);
    const onError = (e: any) => {
      const msg = errorText(e);
      if (/already booked|absent/.test(msg)) setPendingDrop({ ...payload, engineerId, starts_at: start.toISOString(), msg });
      else setDropErr(msg);
    };
    if (payload.type === 'job') book.mutate({ job_id: payload.id, engineer_id: engineerId, starts_at: start.toISOString(), duration_hours: payload.est_hours }, { onError });
    else move.mutate({ id: payload.id, engineer_id: engineerId, starts_at: start.toISOString() }, { onError });
  };

  const dayLabel = view === 'day' ? day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : `w/c ${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;

  return (
    <div className="mx-auto max-w-[1700px]">
      <PageHeader
        title="Schedule"
        subtitle={canEdit ? 'Drag jobs from the list onto an engineer to book them. Drag a visit to move it.' : 'Engineer diaries'}
        actions={
          <>
            <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-auto">
              <option value="all">All engineers</option>
              <option value="service">Service team</option>
              <option value="installation">Installation team</option>
              <option value="sub">Subcontractors</option>
            </Select>
            <div className="flex rounded-md border border-line-strong bg-white">
              {(['day', 'week'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={cx('px-3 py-1.5 text-sm', view === v ? 'bg-navy-800 text-white' : 'text-ink')}>
                  {v === 'day' ? 'Day' : 'Week'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, view === 'day' ? (day.getDay() === 1 ? -3 : -1) : -7))} aria-label="Previous"><ChevronLeft className="size-4" /></Button>
              <Button size="sm" onClick={() => setDay(new Date())}>Today</Button>
              <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, view === 'day' ? (day.getDay() === 5 ? 3 : 1) : 7))} aria-label="Next"><ChevronRight className="size-4" /></Button>
            </div>
            <span className="num min-w-[180px] text-right text-sm font-medium text-navy-900">{dayLabel}</span>
          </>
        }
      />
      <ErrorNote error={dropErr} />
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_320px]">
        <Panel bodyClass="p-0 overflow-x-auto">
          {board.isLoading || !board.data ? (
            <Spinner />
          ) : view === 'day' ? (
            <DayBoard data={board.data} engineers={engineers} day={from} onDrop={onDrop} onSelect={setSelected} canEdit={canEdit} />
          ) : (
            <WeekBoard data={board.data} engineers={engineers} weekStart={weekStart} onDrop={onDrop} onSelect={setSelected} canEdit={canEdit} />
          )}
        </Panel>

        <Panel title={`Unscheduled (${unscheduled.data?.length ?? 0})`} bodyClass="p-0 max-h-[75vh] overflow-y-auto">
          {unscheduled.data?.map((j) => (
            <div
              key={j.id}
              draggable={canEdit}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'job', id: j.id, est_hours: j.est_hours }))}
              className={cx('flex gap-2 border-b border-line px-3 py-2.5', canEdit && 'cursor-grab active:cursor-grabbing hover:bg-paper')}
            >
              {canEdit && <GripVertical className="mt-0.5 size-4 shrink-0 text-line-strong" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <PriorityBadge p={j.priority} />
                  <Link to={`/jobs/${j.id}`} className="num text-xs text-muted hover:underline">{j.job_no}</Link>
                  <span className="text-xs text-muted">{KIND_LABEL[j.kind]} · {j.est_hours}h</span>
                </div>
                <div className="mt-0.5 truncate text-sm">{j.title}</div>
                <div className="truncate text-xs text-muted">{j.site_name}, {j.site_town}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {j.required_skills.map((s: string) => <Badge key={s}>{SKILL_SHORT[s]}</Badge>)}
                  {j.status === 'on_hold' && <Badge tone="orange">On hold</Badge>}
                </div>
                {j.respond_by && <div className="mt-1"><SlaHeat job={j} compact /></div>}
                {j.due_on && !j.respond_by && <div className="mt-1 text-xs text-muted">Due {shortDate(j.due_on)}</div>}
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.job_no} — ${selected.title}` : ''} footer={selected && <Link to={`/jobs/${selected.job_id}`}><Button variant="primary">Open job</Button></Link>}>
        {selected && (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2"><PriorityBadge p={selected.priority} /><VisitStatus s={selected.status} /><Badge>{KIND_LABEL[selected.kind]}</Badge></div>
            <div>{selected.customer_name} · {selected.site_name}, {selected.postcode}</div>
            <div className="num">{dateTime(selected.starts_at)} – {time(selected.ends_at)}</div>
          </div>
        )}
      </Modal>
      <Modal
        open={!!pendingDrop}
        onClose={() => setPendingDrop(null)}
        title="Clash"
        footer={
          <>
            <Button onClick={() => setPendingDrop(null)}>Don't book</Button>
            <Button variant="danger" onClick={() => (pendingDrop.type === 'job' ? book.mutate({ job_id: pendingDrop.id, engineer_id: pendingDrop.engineerId, starts_at: pendingDrop.starts_at, duration_hours: pendingDrop.est_hours, force: true }) : move.mutate({ id: pendingDrop.id, engineer_id: pendingDrop.engineerId, starts_at: pendingDrop.starts_at, force: true }))}>
              Book anyway
            </Button>
          </>
        }
      >
        <p className="text-sm">{pendingDrop?.msg}</p>
      </Modal>
    </div>
  );
}

function rowData(data: any, engineerId: number) {
  return {
    visits: data.visits.filter((v: any) => v.engineer_id === engineerId),
    absences: data.absences.filter((a: any) => a.engineer_id === engineerId),
    onCall: data.on_call.some((o: any) => o.engineer_id === engineerId),
  };
}

function EngineerCell({ e, onCall }: { e: any; onCall: boolean }) {
  return (
    <div className="sticky left-0 z-10 flex w-48 shrink-0 items-center gap-2 border-r border-line bg-white px-3 py-2">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: e.colour }} />
      <div className="min-w-0">
        <Link to={`/engineers/${e.id}`} className="block truncate text-sm font-medium hover:underline">{e.name}</Link>
        <div className="truncate text-xs text-muted">
          {e.kind === 'subcontractor' ? e.company : `${e.grade === 'apprentice' ? 'Apprentice' : e.team === 'installation' ? 'Install' : 'Service'}`} {onCall && <span className="text-steel-600"><Phone className="inline size-3" /> on call</span>}
        </div>
      </div>
    </div>
  );
}

function DayBoard({ data, engineers, day, onDrop, onSelect, canEdit }: any) {
  const now = new Date();
  const nowPos = ymd(now) === day ? ((now.getHours() + now.getMinutes() / 60 - DAY_START) / HOURS) * 100 : null;
  return (
    <div className="min-w-[1000px]">
      <div className="flex border-b border-line bg-paper/60 text-xs text-muted">
        <div className="sticky left-0 w-48 shrink-0 border-r border-line bg-paper px-3 py-1.5">Engineer</div>
        <div className="relative flex flex-1">
          {Array.from({ length: HOURS }).map((_, i) => (
            <div key={i} className="num flex-1 border-l border-line/60 px-1 py-1.5">{String(DAY_START + i).padStart(2, '0')}:00</div>
          ))}
        </div>
      </div>
      {engineers.map((e: any) => {
        const { visits, absences, onCall } = rowData(data, e.id);
        const booked = visits.reduce((s: number, v: any) => s + (new Date(v.ends_at).getTime() - new Date(v.starts_at).getTime()) / 3600_000, 0);
        return (
          <div key={e.id} className="flex border-b border-line last:border-0">
            <EngineerCell e={e} onCall={onCall} />
            <div
              className="relative h-[68px] flex-1"
              onDragOver={(ev) => canEdit && ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault();
                const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                const hour = DAY_START + ((ev.clientX - rect.left) / rect.width) * HOURS;
                onDrop(e.id, day, Math.max(DAY_START, hour), ev.dataTransfer.getData('text/plain'));
              }}
            >
              {Array.from({ length: HOURS }).map((_, i) => (
                <div key={i} className={cx('absolute top-0 bottom-0 border-l border-line/50', (DAY_START + i < 8 || DAY_START + i >= 17) && 'bg-paper/70')} style={{ left: `${(i / HOURS) * 100}%`, width: `${100 / HOURS}%` }} />
              ))}
              {nowPos !== null && nowPos > 0 && nowPos < 100 && <div className="absolute top-0 bottom-0 z-[5] w-px bg-hot" style={{ left: `${nowPos}%` }} />}
              {absences.map((a: any) => {
                const { left, width } = span(a.starts_at, a.ends_at, day);
                return (
                  <div key={a.id} className="absolute top-1 bottom-1 flex items-center justify-center rounded border border-dashed border-line-strong bg-[repeating-linear-gradient(135deg,#eef1f4_0,#eef1f4_6px,#f8f9fa_6px,#f8f9fa_12px)] text-xs text-muted" style={{ left: `${left}%`, width: `${width}%` }}>
                    {a.kind === 'holiday' ? 'Holiday' : a.kind === 'training' ? 'Training' : a.kind === 'sick' ? 'Sick' : 'Unavailable'}{a.notes ? ` — ${a.notes}` : ''}
                  </div>
                );
              })}
              {visits.map((v: any) => {
                const { left, width } = span(v.starts_at, v.ends_at, day);
                return (
                  <button
                    key={v.id}
                    draggable={canEdit && ['scheduled', 'accepted'].includes(v.status)}
                    onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'visit', id: v.id }))}
                    onClick={() => onSelect(v)}
                    className={cx('absolute top-1.5 bottom-1.5 z-[6] overflow-hidden rounded border px-1.5 py-1 text-left hover:shadow-md', kindColour[v.kind] ?? 'bg-paper border-line', ['completed', 'incomplete'].includes(v.status) && 'opacity-60')}
                    style={{ left: `${left}%`, width: `calc(${width}% - 2px)` }}
                    title={`${v.job_no} ${v.title} — ${v.site_name}`}
                  >
                    <div className="flex items-center gap-1 text-[11px] leading-tight">
                      {v.priority === 'P1' && <span className="size-1.5 rounded-full bg-scald" />}
                      <span className="num font-semibold">{time(v.starts_at)}</span>
                      <span className="truncate text-muted">{v.status === 'on_site' ? 'On site' : v.status === 'travelling' ? 'En route' : v.status === 'completed' ? 'Done' : ''}</span>
                    </div>
                    <div className="truncate text-xs font-medium">{v.site_name}</div>
                    <div className="truncate text-[11px] text-muted">{v.title}</div>
                  </button>
                );
              })}
              <div className="num absolute right-1 bottom-0.5 text-[10px] text-muted">{booked.toFixed(1)}h</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function span(startIso: string, endIso: string, day: string) {
  const dayStart = new Date(`${day}T00:00:00`);
  dayStart.setHours(DAY_START);
  const s = Math.max(0, (new Date(startIso).getTime() - dayStart.getTime()) / 3600_000);
  const e = Math.min(HOURS, (new Date(endIso).getTime() - dayStart.getTime()) / 3600_000);
  return { left: (s / HOURS) * 100, width: Math.max(0.5, ((e - s) / HOURS) * 100) };
}

function WeekBoard({ data, engineers, weekStart, onDrop, onSelect, canEdit }: any) {
  const days = Array.from({ length: 5 }).map((_, i) => addDays(weekStart, i));
  const today = ymd(new Date());
  return (
    <div className="min-w-[1000px]">
      <div className="flex border-b border-line bg-paper/60 text-xs text-muted">
        <div className="sticky left-0 w-48 shrink-0 border-r border-line bg-paper px-3 py-1.5">Engineer</div>
        {days.map((d) => (
          <div key={ymd(d)} className={cx('flex-1 border-l border-line/60 px-2 py-1.5', ymd(d) === today && 'font-semibold text-navy-900')}>{shortDate(ymd(d))}</div>
        ))}
      </div>
      {engineers.map((e: any) => {
        const { visits, absences, onCall } = rowData(data, e.id);
        return (
          <div key={e.id} className="flex border-b border-line last:border-0">
            <EngineerCell e={e} onCall={onCall} />
            {days.map((d) => {
              const ds = ymd(d);
              const dv = visits.filter((v: any) => ymd(new Date(v.starts_at)) === ds);
              const absent = absences.find((a: any) => ymd(new Date(a.starts_at)) <= ds && ymd(new Date(a.ends_at)) >= ds);
              const hours = dv.reduce((s: number, v: any) => s + (new Date(v.ends_at).getTime() - new Date(v.starts_at).getTime()) / 3600_000, 0);
              return (
                <div
                  key={ds}
                  className={cx('min-h-[72px] flex-1 space-y-1 border-l border-line/60 p-1', ds === today && 'bg-steel-50/40', absent && 'bg-[repeating-linear-gradient(135deg,#eef1f4_0,#eef1f4_6px,#f8f9fa_6px,#f8f9fa_12px)]')}
                  onDragOver={(ev) => canEdit && ev.preventDefault()}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    const lastEnd = dv.length ? new Date(dv[dv.length - 1].ends_at) : null;
                    const hour = lastEnd ? lastEnd.getHours() + lastEnd.getMinutes() / 60 + 0.5 : 8.5;
                    onDrop(e.id, ds, hour, ev.dataTransfer.getData('text/plain'));
                  }}
                >
                  {absent && <div className="text-center text-xs text-muted">{absent.kind === 'holiday' ? 'Holiday' : absent.kind === 'training' ? 'Training' : 'Unavailable'}</div>}
                  {dv.map((v: any) => (
                    <button key={v.id} onClick={() => onSelect(v)} draggable={canEdit && ['scheduled', 'accepted'].includes(v.status)} onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ type: 'visit', id: v.id }))} className={cx('block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px]', kindColour[v.kind], ['completed', 'incomplete'].includes(v.status) && 'opacity-60')}>
                      <span className="num font-semibold">{time(v.starts_at)}</span> {v.site_name}
                    </button>
                  ))}
                  {!absent && <div className={cx('num text-right text-[10px]', hours > 8 ? 'text-scald' : 'text-muted')}>{hours ? `${hours.toFixed(1)}h` : 'free'}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
