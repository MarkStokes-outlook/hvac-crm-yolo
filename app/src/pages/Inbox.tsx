import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Mail, Phone, Globe, Voicemail, Sparkles, ClipboardPlus, FilePlus2, Check, X } from 'lucide-react';
import { errorText, patch, post, useAction, useApi } from '../lib/api';
import { useAi } from '../components/AiPanel';
import { Badge, Button, Empty, ErrorNote, PageHeader, Panel, Select, Spinner, cx } from '../components/ui';
import { PriorityBadge, SKILL_SHORT } from '../components/domain';
import { dateTime, relative, titleCase } from '../lib/format';

const CHANNEL_ICON: Record<string, any> = { email: Mail, phone: Phone, web: Globe, voicemail: Voicemail };

export default function Inbox() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const list = useApi<any[]>(`/enquiries?status=${status}`);
  const selectedId = id ? Number(id) : list.data?.[0]?.id;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Service desk inbox"
        subtitle="Emails, voicemails and web enquiries to the shared service mailbox"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="open">Open</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </Select>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
        <Panel bodyClass="p-0">
          {list.isLoading && <Spinner />}
          {list.data?.length === 0 && <Empty title="Inbox clear">No enquiries waiting.</Empty>}
          <ul className="divide-y divide-line">
            {list.data?.map((e) => {
              const Icon = CHANNEL_ICON[e.channel] ?? Mail;
              return (
                <li key={e.id}>
                  <button onClick={() => navigate(`/inbox/${e.id}`)} className={cx('block w-full px-4 py-3 text-left', selectedId === e.id ? 'bg-steel-50' : 'hover:bg-paper')}>
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 text-muted" />
                      <span className={cx('flex-1 truncate text-sm', e.status === 'new' ? 'font-semibold text-ink' : 'text-ink')}>{e.from_name ?? e.from_email ?? e.from_phone}</span>
                      <span className="num text-xs text-muted">{relative(e.received_at)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-ink">{e.subject}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {e.customer_name ? <Badge tone="blue">{e.customer_name}</Badge> : <Badge>Unknown sender</Badge>}
                      {e.triage?.priority && <PriorityBadge p={e.triage.priority} />}
                      {e.job_no && <Badge tone="green">{e.job_no}</Badge>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
        {selectedId ? <EnquiryView id={selectedId} /> : <Panel><Empty title="Select an enquiry" /></Panel>}
      </div>
    </div>
  );
}

function EnquiryView({ id }: { id: number }) {
  const navigate = useNavigate();
  const { ask } = useAi();
  const { data: e, isLoading } = useApi<any>(`/enquiries/${id}`);
  const [triage, setTriage] = useState<any>(null);
  const [triaging, setTriaging] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setStatus = useAction((s: string) => patch(`/enquiries/${id}`, { status: s }));

  useEffect(() => {
    setTriage(e?.triage ?? null);
    setErr(null);
  }, [e?.id, e?.triage]);

  if (isLoading || !e) return <Spinner />;

  const runTriage = async () => {
    setTriaging(true);
    setErr(null);
    try {
      setTriage(await post('/ai/triage', { text: `${e.subject ?? ''}\n\n${e.body}`, enquiry_id: e.id }));
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setTriaging(false);
    }
  };

  const createJob = () => {
    const site = triage?.site_candidates?.length === 1 ? triage.site_candidates[0] : null;
    const params = new URLSearchParams({
      enquiry_id: String(e.id),
      ...(site ? { site_id: String(site.id) } : e.site_id ? { site_id: String(e.site_id) } : {}),
      ...(triage ? { title: triage.summary, description: triage.fault_description, priority: triage.priority, reported_via: e.channel === 'voicemail' ? 'phone' : e.channel, ...(triage.customer_ref ? { customer_ref: triage.customer_ref } : {}), ...(triage.contact_name ? { reported_by: triage.contact_name } : {}), skills: (triage.required_skills ?? []).join(','), assets: (triage.asset_candidates ?? []).slice(0, 1).map((a: any) => a.id).join(',') } : { title: e.subject ?? '', description: e.body, reported_via: e.channel === 'voicemail' ? 'phone' : e.channel }),
      ...(e.from_name && !triage?.contact_name ? { reported_by: e.from_name } : {}),
    });
    navigate(`/jobs/new?${params}`);
  };

  return (
    <div className="space-y-4">
      <Panel
        title={e.subject ?? 'Enquiry'}
        actions={
          e.status === 'new' || e.status === 'in_progress' ? (
            <>
              <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setStatus.mutate('dismissed')}>
                Dismiss
              </Button>
              <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => setStatus.mutate('actioned')}>
                Mark actioned
              </Button>
            </>
          ) : (
            <Badge tone={e.status === 'actioned' ? 'green' : 'neutral'}>{titleCase(e.status)}</Badge>
          )
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            From <span className="text-ink">{e.from_name}</span> {e.from_email && `<${e.from_email}>`} {e.from_phone}
          </span>
          <span>{dateTime(e.received_at)}</span>
          <span>{titleCase(e.channel)}</span>
        </div>
        {e.matches?.length > 0 ? (
          <div className="mb-3 text-sm">
            Matched to{' '}
            {e.matches.slice(0, 2).map((m: any, i: number) => (
              <span key={i}>
                <Link className="font-medium text-steel-600 hover:underline" to={`/customers/${m.customer_id}`}>{m.customer_name}</Link>
                {m.site_name && <> · <Link className="text-steel-600 hover:underline" to={`/sites/${m.site_id}`}>{m.site_name}</Link></>}
                {m.contact_name && <span className="text-muted"> ({m.contact_name}, by {m.matched_on})</span>}
              </span>
            ))}
          </div>
        ) : (
          <div className="mb-3 text-sm text-muted">Sender not recognised — may be a new customer.</div>
        )}
        <div className="rounded-md bg-paper p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink">{e.body}</div>
        {e.job_no && (
          <div className="mt-3 text-sm">
            Job created: <Link to={`/jobs/${e.job_id}`} className="font-medium text-steel-600 hover:underline">{e.job_no}</Link>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Sparkles className="size-4" />} loading={triaging} onClick={runTriage}>
            {triage ? 'Re-run triage' : 'Triage'}
          </Button>
          <Button icon={<ClipboardPlus className="size-4" />} onClick={createJob}>
            Create job
          </Button>
          <Button icon={<FilePlus2 className="size-4" />} onClick={() => ask(`Enquiry #${e.id} from ${e.from_name ?? e.from_email} ("${e.subject}") is a quote request. Set up a draft quote or survey job as appropriate, link it to the right customer and site, and mark the enquiry in progress.`)}>
            Handle as quote request
          </Button>
          <Button variant="ghost" icon={<Sparkles className="size-4" />} onClick={() => ask(`Deal with inbox enquiry #${e.id}: work out what it needs, log a job if it is a fault (right site, equipment and priority), find the best engineer and book them, then draft a short reply I can send.`)}>
            Let the assistant handle it
          </Button>
        </div>
        <div className="mt-3">
          <ErrorNote error={err} />
        </div>
      </Panel>

      {triage && (
        <Panel title={<span className="flex items-center gap-2">Triage {triage.source === 'rules' ? <Badge>Rule-based (AI not configured)</Badge> : <Badge tone="blue"><Sparkles className="size-3" /> AI</Badge>}</span>}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <PriorityBadge p={triage.priority} /> <span className="font-medium">{triage.summary}</span>
              </div>
              <div className="text-muted">{triage.priority_reason}</div>
              <div>
                <span className="text-muted">Request type:</span> {titleCase(triage.request_type)}
              </div>
              {triage.customer_ref && (
                <div>
                  <span className="text-muted">Customer ref:</span> {triage.customer_ref}
                </div>
              )}
              {triage.access_constraints && (
                <div>
                  <span className="text-muted">Access:</span> {triage.access_constraints}
                </div>
              )}
              {triage.required_skills?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {triage.required_skills.map((s: string) => (
                    <Badge key={s}>{SKILL_SHORT[s] ?? s}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="text-muted">Likely site</div>
              {triage.site_candidates?.length ? (
                triage.site_candidates.slice(0, 4).map((s: any) => (
                  <Link key={s.id} to={`/sites/${s.id}`} className="block hover:underline">
                    {s.name} <span className="text-muted">— {s.customer_name}, {s.postcode}</span>
                  </Link>
                ))
              ) : (
                <div className="text-muted">No site match — check the address.</div>
              )}
              {triage.asset_candidates?.length > 0 && (
                <>
                  <div className="pt-1 text-muted">Possible equipment</div>
                  {triage.asset_candidates.map((a: any) => (
                    <div key={a.id}>
                      {a.tag} {a.category} <span className="text-muted">{a.location}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          {triage.suggested_reply && (
            <div className="mt-4">
              <div className="mb-1 text-xs text-muted">Suggested acknowledgement</div>
              <div className="rounded-md border border-line p-3 text-sm whitespace-pre-wrap">{triage.suggested_reply}</div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
