import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, Plus, Sparkles, UserPlus } from 'lucide-react';
import { patch, post, queryClient, useAction, useApi } from '../lib/api';
import { perms, useAuth, useMeta } from '../lib/auth';
import { useAi, useAiEntity } from '../components/AiPanel';
import { Badge, Button, ErrorNote, Field, Input, KV, PageHeader, Panel, Select, Spinner, Table, Tabs, Textarea } from '../components/ui';
import { EntityLink, QuoteStatus } from '../components/domain';
import { FormModal, type FieldSpec } from '../components/FormModal';
import { customerFields } from './Customers';
import { date, dateTime, money, titleCase } from '../lib/format';

export const siteFields: FieldSpec[] = [
  { name: 'name', label: 'Site name', required: true, wide: true },
  { name: 'address', label: 'Address', wide: true },
  { name: 'town', label: 'Town' },
  { name: 'county', label: 'County' },
  { name: 'postcode', label: 'Postcode', required: true, hint: 'Used to estimate engineer travel time' },
  { name: 'building_type', label: 'Building type' },
  { name: 'opening_hours', label: 'Opening / access hours', wide: true },
  { name: 'access_notes', label: 'Access notes', type: 'textarea' },
  { name: 'parking_notes', label: 'Parking' },
  { name: 'ooh_access', label: 'Out-of-hours access' },
  { name: 'hazards', label: 'Hazards', type: 'textarea' },
  { name: 'induction_required', label: 'Induction required', type: 'checkbox' },
  { name: 'dbs_required', label: 'DBS-checked engineers only', type: 'checkbox' },
  { name: 'permit_to_work', label: 'Permit to work', type: 'checkbox' },
];

export const contactFields = (sites: any[]): FieldSpec[] => [
  { name: 'name', label: 'Name', required: true },
  { name: 'job_title', label: 'Job title' },
  { name: 'phone', label: 'Phone' },
  { name: 'mobile', label: 'Mobile' },
  { name: 'email', label: 'Email', type: 'email', wide: true },
  { name: 'site_id', label: 'Site (blank = head office)', type: 'select', options: sites.map((s) => [s.id, s.name]) },
  { name: 'is_primary', label: 'Primary contact', type: 'checkbox' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export default function CustomerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const p = perms(user);
  const meta = useMeta();
  const navigate = useNavigate();
  const { ask } = useAi();
  const { data: c, isLoading } = useApi<any>(`/customers/${id}`);
  const [tab, setTab] = useState<'sites' | 'contacts' | 'contracts' | 'quotes' | 'activity'>('sites');
  const [modal, setModal] = useState<null | 'edit' | 'site' | 'contact'>(null);
  useAiEntity(c ? { type: 'customer', id: c.id, label: c.name } : null);
  if (isLoading || !c) return <Spinner />;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={c.name}
        subtitle={<span className="num">{c.account_no} · {titleCase(c.kind)} · {c.sector}</span>}
        actions={
          <>
            <Button icon={<Sparkles className="size-4" />} onClick={() => ask(`Give me a quick account summary for ${c.name}: contract position and renewal, recent reactive issues and any recurring problems, open quotes and anything I should raise with them.`)}>Account summary</Button>
            {p.crmEdit && <Button onClick={() => setModal('edit')}>Edit</Button>}
            {p.quotes && <Link to={`/quotes?new=1&customer_id=${c.id}`}><Button icon={<FilePlus2 className="size-4" />}>New quote</Button></Link>}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={c.status === 'active' ? 'green' : 'neutral'}>{titleCase(c.status)}</Badge>
          {c.on_stop ? <Badge tone="red">On stop — {c.on_stop_reason}</Badge> : null}
          {c.po_required ? <Badge tone="amber">PO required</Badge> : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'sites', label: 'Sites', count: c.sites.length },
            { id: 'contacts', label: 'Contacts', count: c.contacts.length },
            { id: 'contracts', label: 'Contracts', count: c.contracts.length },
            { id: 'quotes', label: 'Quotes', count: c.quotes.length },
            { id: 'activity', label: 'Activity', count: c.activities.length },
          ]} />
          {tab === 'sites' && (
            <Panel bodyClass="p-0" actions={p.crmEdit && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setModal('site')}>Add site</Button>} title="Sites">
              <Table rows={c.sites} rowLink={(s: any) => `/sites/${s.id}`} empty="No sites yet" columns={[
                { key: 'n', label: 'Site', render: (s: any) => (<div><div className="font-medium">{s.name}</div><div className="text-xs text-muted">{s.address}, {s.town} {s.postcode}</div></div>) },
                { key: 'b', label: 'Building', render: (s: any) => <span className="text-xs">{s.building_type}{s.end_client_name && <div className="text-muted">Client: {s.end_client_name}</div>}</span> },
                { key: 'a', label: 'Equipment', render: (s: any) => <span className="num">{s.asset_count}</span> },
                { key: 'o', label: 'Open jobs', render: (s: any) => <span className="num">{s.open_jobs}</span> },
              ]} />
            </Panel>
          )}
          {tab === 'contacts' && (
            <Panel bodyClass="p-0" title="Contacts" actions={p.crmEdit && <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setModal('contact')}>Add contact</Button>}>
              <Table rows={c.contacts} columns={[
                { key: 'n', label: 'Name', render: (x: any) => (<div><div className="font-medium">{x.name} {x.is_primary ? <Badge tone="blue">Primary</Badge> : null}</div><div className="text-xs text-muted">{x.job_title}</div></div>) },
                { key: 's', label: 'Site', render: (x: any) => <span className="text-xs">{x.site_name ?? 'Head office'}</span> },
                { key: 'p', label: 'Phone', render: (x: any) => <span className="num text-xs">{x.phone}{x.mobile && <div>{x.mobile}</div>}</span> },
                { key: 'e', label: 'Email', render: (x: any) => x.email ? <a href={`mailto:${x.email}`} className="text-xs text-steel-600 hover:underline">{x.email}</a> : null },
                { key: 'r', label: 'Roles', render: (x: any) => <div className="flex flex-wrap gap-1">{x.roles.map((r: string) => <Badge key={r}>{titleCase(r)}</Badge>)}</div> },
              ]} />
            </Panel>
          )}
          {tab === 'contracts' && (
            <Panel bodyClass="p-0">
              <Table rows={c.contracts} rowLink={(x: any) => `/contracts/${x.id}`} empty="No contracts — reactive work is chargeable at standard rates" columns={[
                { key: 'r', label: 'Contract', render: (x: any) => (<div><div className="num font-medium">{x.ref}</div><div className="text-xs text-muted">{x.name}</div></div>) },
                { key: 'l', label: 'Cover', render: (x: any) => <span className="text-xs">{titleCase(x.level).replace('Ppm', 'PPM')}{x.ooh_cover ? ' · OOH' : ''}</span> },
                { key: 'd', label: 'Term', render: (x: any) => <span className="num text-xs">{date(x.starts_on)} – {date(x.ends_on)}</span> },
                { key: 'v', label: 'Annual value', render: (x: any) => <span className="num">{money(x.annual_value)}</span> },
                { key: 's', label: 'Status', render: (x: any) => <Badge tone={x.status === 'active' ? 'green' : 'neutral'}>{titleCase(x.status)}</Badge> },
              ]} />
            </Panel>
          )}
          {tab === 'quotes' && (
            <Panel bodyClass="p-0">
              <Table rows={c.quotes} rowLink={(x: any) => `/quotes/${x.id}`} empty="No quotes" columns={[
                { key: 'n', label: 'Quote', render: (x: any) => <span className="num font-medium">{x.quote_no}</span> },
                { key: 't', label: 'Title', render: (x: any) => (<div>{x.title}<div className="text-xs text-muted">{x.site_name}</div></div>) },
                { key: 'v', label: 'Value', render: (x: any) => <span className="num">{money(x.total)}</span> },
                { key: 's', label: 'Status', render: (x: any) => <QuoteStatus s={x.status} /> },
                { key: 'd', label: 'Created', render: (x: any) => <span className="num text-xs">{date(x.created_at)}</span> },
              ]} />
            </Panel>
          )}
          {tab === 'activity' && <Activity customer={c} />}
        </div>

        <aside className="space-y-4">
          <Panel title="Account">
            <KV cols={1} items={[
              ['Account manager', c.account_manager_name],
              ['Phone', c.phone],
              ['Email', c.email],
              ['Billing', `${c.billing_address ?? ''} ${c.billing_postcode ?? ''}`],
              ['Invoices to', c.invoice_email],
              ['Payment terms', `${c.payment_terms_days} days`],
              ['Source', c.source],
            ]} />
            {c.notes && <p className="mt-3 border-t border-line pt-3 text-sm whitespace-pre-wrap">{c.notes}</p>}
          </Panel>
          <Panel title="Last 12 months">
            <KV cols={1} items={[
              ['Jobs', c.stats.jobs_12m],
              ['Reactive call-outs', c.stats.reactive_12m ?? 0],
              ['Open jobs', c.stats.open_jobs ?? 0],
              ['Invoiced', money(c.stats.invoiced_12m)],
            ]} />
          </Panel>
          {c.managed_sites.length > 0 && (
            <Panel title="Sites managed by others">
              {c.managed_sites.map((s: any) => (
                <div key={s.id} className="py-1 text-sm"><EntityLink to={`/sites/${s.id}`}>{s.name}</EntityLink> <span className="text-muted">via {s.customer_name}</span></div>
              ))}
            </Panel>
          )}
        </aside>
      </div>

      <FormModal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit customer" fields={customerFields(meta?.users)} initial={{ ...c, po_required: !!c.po_required }} onSubmit={(v) => patch(`/customers/${c.id}`, v).then(() => queryClient.invalidateQueries())} />
      <FormModal open={modal === 'site'} onClose={() => setModal(null)} title="Add site" fields={siteFields} onSubmit={async (v) => { const s = await post('/sites', { ...v, customer_id: c.id }); navigate(`/sites/${s.id}`); }} submitLabel="Add site" />
      <FormModal open={modal === 'contact'} onClose={() => setModal(null)} title="Add contact" fields={contactFields(c.sites)} onSubmit={(v) => post('/contacts', { ...v, customer_id: c.id, roles: v.is_primary ? ['primary'] : [] }).then(() => queryClient.invalidateQueries())} submitLabel="Add contact" />
    </div>
  );
}

function Activity({ customer }: { customer: any }) {
  const [f, setF] = useState({ kind: 'call', subject: '', body: '', due_on: '' });
  const add = useAction((b: any) => post('/activities', b), () => setF({ kind: 'call', subject: '', body: '', due_on: '' }));
  const done = useAction((aid: number) => patch(`/activities/${aid}`, { done: true }));
  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="note">Note</option>
            <option value="task">Task / follow-up</option>
          </Select>
          <Input placeholder="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <Textarea className="sm:col-span-2" rows={2} placeholder="Details" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          {f.kind === 'task' && <Field label="Due"><Input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} /></Field>}
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="primary" disabled={f.subject.length < 2} onClick={() => add.mutate({ ...f, customer_id: customer.id, due_on: f.due_on || null })}>Log</Button>
        </div>
        <ErrorNote error={add.error?.message} />
      </Panel>
      <Panel bodyClass="p-0">
        <ul className="divide-y divide-line">
          {customer.activities.map((a: any) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-muted">
                <Badge tone={a.kind === 'task' ? (a.done ? 'green' : 'amber') : 'neutral'}>{titleCase(a.kind)}</Badge>
                <span className="font-medium text-ink">{a.user_name}</span>
                <span className="num">{dateTime(a.created_at)}</span>
                {a.due_on && <span>due {date(a.due_on)}</span>}
                {a.kind === 'task' && !a.done && <button onClick={() => done.mutate(a.id)} className="ml-auto text-steel-600 hover:underline">Mark done</button>}
              </div>
              <div className="mt-1 text-sm font-medium">{a.subject}</div>
              {a.body && <div className="text-sm whitespace-pre-wrap text-muted">{a.body}</div>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

