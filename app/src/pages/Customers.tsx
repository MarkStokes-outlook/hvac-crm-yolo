import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { post, useApi } from '../lib/api';
import { perms, useAuth, useMeta } from '../lib/auth';
import { Badge, Button, Input, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { FormModal, type FieldSpec } from '../components/FormModal';
import { titleCase } from '../lib/format';

export const SECTORS = ['Offices & Commercial Property', 'Retail', 'Hospitality & Leisure', 'Education', 'Healthcare & Care', 'Light Industrial & Warehousing', 'Multi-Site & Facilities Management'];

export function customerFields(users: any[] = []): FieldSpec[] {
  return [
    { name: 'name', label: 'Company name', required: true, wide: true },
    { name: 'kind', label: 'Customer type', type: 'select', options: [['end_client', 'End client'], ['managing_agent', 'Managing agent'], ['fm_provider', 'FM provider'], ['main_contractor', 'Main contractor'], ['public_sector', 'Public sector']] },
    { name: 'sector', label: 'Sector', type: 'select', options: SECTORS.map((s) => [s, s]) },
    { name: 'status', label: 'Status', type: 'select', options: [['prospect', 'Prospect'], ['active', 'Active'], ['inactive', 'Inactive']] },
    { name: 'account_manager_id', label: 'Account manager', type: 'select', options: users.filter((u) => ['sales', 'manager', 'admin'].includes(u.role)).map((u) => [u.id, u.name]) },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'billing_address', label: 'Billing address', wide: true },
    { name: 'billing_postcode', label: 'Billing postcode' },
    { name: 'invoice_email', label: 'Invoice email', type: 'email' },
    { name: 'payment_terms_days', label: 'Payment terms (days)', type: 'number' },
    { name: 'vat_number', label: 'VAT number' },
    { name: 'po_required', label: 'PO required for chargeable work', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

export default function Customers() {
  const { user } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sector, setSector] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useApi<any[]>(`/customers?search=${encodeURIComponent(search)}&status=${status}&sector=${encodeURIComponent(sector)}`);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Customers & sites" subtitle={data ? `${data.length} customers` : undefined} actions={perms(user).crmEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add customer</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Name, account, site, postcode or contact…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="prospect">Prospect</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select value={sector} onChange={(e) => setSector(e.target.value)} className="w-auto">
          <option value="">All sectors</option>
          {SECTORS.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      <Panel bodyClass="p-0">
        {isLoading ? <Spinner /> : (
          <Table
            rows={data ?? []}
            rowLink={(c: any) => `/customers/${c.id}`}
            columns={[
              { key: 'n', label: 'Customer', render: (c: any) => (<div><div className="font-medium">{c.name}</div><div className="num text-xs text-muted">{c.account_no}</div></div>) },
              { key: 'k', label: 'Type', render: (c: any) => (<div className="text-xs"><div>{titleCase(c.kind)}</div><div className="text-muted">{c.sector}</div></div>) },
              { key: 's', label: 'Sites', render: (c: any) => <span className="num">{c.site_count}</span> },
              { key: 'ct', label: 'Contract', render: (c: any) => (c.active_contracts ? <Badge tone="blue">{c.active_contracts}</Badge> : <span className="text-xs text-muted">None</span>) },
              { key: 'o', label: 'Open jobs', render: (c: any) => <span className="num">{c.open_jobs}</span> },
              { key: 'st', label: 'Account', render: (c: any) => (<div className="flex flex-wrap gap-1">{c.status !== 'active' && <Badge>{titleCase(c.status)}</Badge>}{c.on_stop ? <Badge tone="red">On stop</Badge> : null}{c.po_required ? <Badge tone="amber">PO req.</Badge> : null}</div>) },
              { key: 'am', label: 'Account manager', render: (c: any) => <span className="text-xs">{c.account_manager_name}</span> },
            ]}
          />
        )}
      </Panel>
      <FormModal open={adding} onClose={() => setAdding(false)} title="Add customer" fields={customerFields(meta?.users)} initial={{ kind: 'end_client', status: 'active', payment_terms_days: 30 }} onSubmit={async (v) => { const c = await post('/customers', v); navigate(`/customers/${c.id}`); }} submitLabel="Add customer" />
    </div>
  );
}
