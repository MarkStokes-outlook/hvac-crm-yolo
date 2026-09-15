import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Badge, cx } from './ui';
import { relative, dateTime, titleCase } from '../lib/format';

export function PriorityBadge({ p }: { p: string }) {
  const tone = p === 'P1' ? 'red' : p === 'P2' ? 'orange' : p === 'P3' ? 'blue' : 'neutral';
  return (
    <Badge tone={tone} className="num">
      {p}
    </Badge>
  );
}

const JOB_STATUS: Record<string, [string, any]> = {
  new: ['New', 'amber'],
  scheduled: ['Scheduled', 'blue'],
  in_progress: ['In progress', 'purple'],
  on_hold: ['On hold', 'orange'],
  completed: ['Completed', 'green'],
  closed: ['Closed', 'neutral'],
  cancelled: ['Cancelled', 'neutral'],
};
export function JobStatus({ s, hold }: { s: string; hold?: string | null }) {
  const [label, tone] = JOB_STATUS[s] ?? [s, 'neutral'];
  return (
    <Badge tone={tone} title={hold ? titleCase(hold) : undefined}>
      {label}
      {s === 'on_hold' && hold ? ` · ${titleCase(hold).replace('Awaiting ', '')}` : ''}
    </Badge>
  );
}

const VISIT_STATUS: Record<string, [string, any]> = {
  scheduled: ['Scheduled', 'neutral'],
  accepted: ['Accepted', 'blue'],
  travelling: ['Travelling', 'purple'],
  on_site: ['On site', 'purple'],
  completed: ['Completed', 'green'],
  incomplete: ['Incomplete', 'orange'],
  cancelled: ['Cancelled', 'neutral'],
};
export const VisitStatus = ({ s }: { s: string }) => {
  const [label, tone] = VISIT_STATUS[s] ?? [s, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
};

const QUOTE_STATUS: Record<string, any> = { draft: 'neutral', sent: 'blue', accepted: 'green', declined: 'red', expired: 'amber', cancelled: 'neutral' };
export const QuoteStatus = ({ s }: { s: string }) => <Badge tone={QUOTE_STATUS[s]}>{titleCase(s)}</Badge>;

export const KIND_LABEL: Record<string, string> = {
  reactive: 'Reactive',
  ppm: 'PPM',
  remedial: 'Remedial',
  quoted: 'Quoted works',
  installation: 'Installation',
  survey: 'Survey',
  warranty: 'Warranty',
  recall: 'Recall',
};

/**
 * Thermal SLA indicator — the core visual device. Cool when on track, warming as the deadline approaches,
 * scalding when breached.
 */
export function SlaHeat({ job, compact }: { job: { sla?: { response: string; fix: string }; respond_by?: string | null; fix_by?: string | null; attended_at?: string | null; completed_at?: string | null }; compact?: boolean }) {
  const sla = job.sla;
  if (!sla || (sla.response === 'none' && sla.fix === 'none')) return <span className="text-xs text-muted">—</span>;
  const responding = !job.attended_at && sla.response !== 'none';
  const state = responding ? sla.response : sla.fix;
  const target = responding ? job.respond_by : job.fix_by;
  const label = responding ? 'Attend' : 'Fix';
  if (state === 'met') return <span className="text-xs font-medium text-ok">SLA met</span>;
  if (state === 'none') return <span className="text-xs text-muted">Attended</span>;
  const colour = state === 'breached' ? 'text-scald' : state === 'at_risk' ? 'text-hot' : 'text-cool';
  const bar = state === 'breached' ? 'bg-scald' : state === 'at_risk' ? 'bg-hot' : 'bg-cool';
  return (
    <div className={cx('flex items-center gap-2', compact ? '' : 'min-w-[120px]')} title={`${label} by ${dateTime(target)}`}>
      <span className={cx('h-7 w-1.5 rounded-full', bar)} aria-hidden />
      <div className="leading-tight">
        <div className={cx('num text-[13px] font-semibold', colour)}>{state === 'breached' ? `${label} overdue` : `${label} ${relative(target)}`}</div>
        {!compact && <div className="text-xs text-muted">{dateTime(target)}</div>}
      </div>
    </div>
  );
}

export function FgasBadge({ fgas }: { fgas: any }) {
  if (!fgas || fgas.state === 'not_required') return null;
  const map: Record<string, [string, any]> = { ok: ['F-Gas OK', 'green'], due_soon: ['Leak check due', 'amber'], overdue: ['Leak check overdue', 'red'], never_checked: ['No leak check', 'orange'], unknown: ['F-Gas ?', 'neutral'] };
  const [l, t] = map[fgas.state];
  return (
    <Badge tone={t} title={`${fgas.co2e_tonnes} t CO₂e — every ${fgas.interval_months} months${fgas.next_due_on ? `, next ${fgas.next_due_on}` : ''}`}>
      {l}
    </Badge>
  );
}

export function SiteAlerts({ site }: { site: any }) {
  const items: string[] = [];
  if (site.induction_required) items.push('Induction required');
  if (site.dbs_required) items.push('DBS-checked engineers only');
  if (site.permit_to_work) items.push('Permit to work');
  if (!items.length && !site.hazards) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((i) => (
        <Badge key={i} tone="amber">
          <ShieldAlert className="size-3" /> {i}
        </Badge>
      ))}
      {site.hazards && (
        <Badge tone="orange" title={site.hazards}>
          <AlertTriangle className="size-3" /> Hazards noted
        </Badge>
      )}
    </div>
  );
}

export function Markdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith('/') ? (
              <Link to={href} onClick={onNavigate}>
                {children}
              </Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const SKILL_SHORT: Record<string, string> = {
  ac: 'AC',
  vrf: 'VRF',
  refrigeration: 'Refrigeration',
  heat_pumps: 'Heat pumps',
  chillers: 'Chillers',
  ventilation: 'Ventilation',
  kitchen_extract: 'Kitchen extract',
  heating: 'Heating',
  gas: 'Gas',
  controls: 'Controls',
  electrical: 'Electrical',
  commissioning: 'Commissioning',
};

export function Skills({ skills }: { skills: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {skills.map((s) => (
        <Badge key={s}>{SKILL_SHORT[s] ?? s}</Badge>
      ))}
    </div>
  );
}

export function EntityLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('font-medium text-steel-600 hover:text-navy-800 hover:underline', className)}>
      {children}
    </Link>
  );
}
