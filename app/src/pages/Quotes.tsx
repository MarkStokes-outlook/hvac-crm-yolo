import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { post, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Button, Input, PageHeader, Panel, Select, Spinner, Stat, Table } from '../components/ui';
import { QuoteStatus } from '../components/domain';
import { FormModal } from '../components/FormModal';
import { date, money, titleCase } from '../lib/format';

export default function Quotes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [customerId, setCustomerId] = useState<string>(params.get('customer_id') ?? '');
  const { data, isLoading } = useApi<any[]>(`/quotes?status=${status}&search=${encodeURIComponent(search)}`);
  const pipe = useApi<any>('/quotes/pipeline');
  const customers = useApi<any[]>(adding ? '/customers' : null);
  const sites = useApi<any[]>(adding && customerId ? `/sites?customer_id=${customerId}` : null);
  useEffect(() => setAdding(params.get('new') === '1'), [params]);
  const today = new Date().toISOString().slice(0, 10);
  const pl = pipe.data;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Quotes" actions={perms(user).quotes && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>New quote</Button>} />
      {pl && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Drafts" value={pl.draft_count ?? 0} sub={money(pl.draft_value)} />
          <Stat label="Awaiting decision" value={money(pl.sent_value)} sub={`${pl.sent_count ?? 0} quotes sent`} />
          <Stat label="Follow-ups due" value={pl.follow_ups_due ?? 0} tone={pl.follow_ups_due ? 'hot' : 'cool'} />
          <Stat label="Won, last 90 days" value={money(pl.won_value_90d)} tone="ok" sub={`${pl.won_90d ?? 0} won · ${pl.lost_90d ?? 0} lost`} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Quote no, title, customer, site…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="open">Open (draft & sent)</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
          <option value="expired">Expired</option>
          <option value="">All</option>
        </Select>
      </div>
      <Panel bodyClass="p-0">
        {isLoading ? <Spinner /> : (
          <Table rows={data ?? []} rowLink={(q: any) => `/quotes/${q.id}`} empty="No quotes" columns={[
            { key: 'n', label: 'Quote', render: (q: any) => <span className="num font-medium">{q.quote_no}</span> },
            { key: 't', label: 'Title', render: (q: any) => (<div className="min-w-[240px]"><div>{q.title}</div><div className="text-xs text-muted">{q.customer_name}{q.site_name ? ` · ${q.site_name}` : ''}</div></div>) },
            { key: 'k', label: 'Type', render: (q: any) => <span className="text-xs">{titleCase(q.kind)}</span> },
            { key: 'v', label: 'Value', render: (q: any) => (<div className="num text-right"><div>{money(q.total)}</div><div className="text-xs text-muted">{q.total ? `${Math.round(((q.total - q.cost) / q.total) * 100)}% margin` : ''}</div></div>), className: 'text-right' },
            { key: 's', label: 'Status', render: (q: any) => <QuoteStatus s={q.status} /> },
            { key: 'f', label: 'Follow up', render: (q: any) => q.status === 'sent' && <span className={q.follow_up_on && q.follow_up_on <= today ? 'num text-xs font-medium text-hot' : 'num text-xs'}>{date(q.follow_up_on)}</span> },
            { key: 'p', label: 'By', render: (q: any) => <span className="text-xs">{q.prepared_by_name}</span> },
            { key: 'd', label: 'Created', render: (q: any) => <span className="num text-xs">{date(q.created_at)}</span> },
          ]} />
        )}
      </Panel>
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="New quote"
        submitLabel="Create draft"
        initial={{ customer_id: customerId, kind: 'repair' }}
        fields={[
          { name: 'customer_id', label: 'Customer', type: 'select', required: true, options: (customers.data ?? []).map((c) => [String(c.id), c.name]), wide: true },
          { name: 'site_id', label: 'Site', type: 'select', options: (sites.data ?? []).map((s) => [s.id, s.name]), },
          { name: 'kind', label: 'Type', type: 'select', options: [['repair', 'Repair'], ['remedial', 'Remedial'], ['replacement', 'Replacement'], ['installation', 'Installation'], ['maintenance_contract', 'Maintenance contract'], ['other', 'Other']] },
          { name: 'title', label: 'Title', required: true, wide: true },
          { name: 'scope', label: 'Scope of works', type: 'textarea' },
        ]}
        onValuesChange={(v) => v.customer_id !== customerId && setCustomerId(v.customer_id ?? '')}
        onSubmit={async (v) => {
          const q = await post('/quotes', { ...v, customer_id: Number(v.customer_id) });
          navigate(`/quotes/${q.id}`);
        }}
      />
    </div>
  );
}
