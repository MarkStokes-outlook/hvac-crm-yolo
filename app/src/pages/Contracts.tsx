import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { post, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Badge, Button, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { FormModal } from '../components/FormModal';
import { date, money, titleCase } from '../lib/format';

export const levelLabel = (l: string) => ({ ppm_only: 'PPM only', ppm_reactive: 'PPM + reactive', comprehensive: 'Comprehensive' })[l] ?? l;

export default function Contracts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('active');
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useApi<any[]>(`/contracts${status ? `?status=${status}` : ''}`);
  const customers = useApi<any[]>(adding ? '/customers' : null);
  const total = (data ?? []).filter((c) => c.status === 'active').reduce((s, c) => s + c.annual_value, 0);
  const soon = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Maintenance contracts"
        subtitle={status === 'active' ? `${data?.length ?? 0} active · ${money(total)} annual value` : undefined}
        actions={
          <>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="draft">Draft</option>
              <option value="">All</option>
            </Select>
            {perms(user).contracts && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>New contract</Button>}
          </>
        }
      />
      <Panel bodyClass="p-0">
        {isLoading ? <Spinner /> : (
          <Table rows={data ?? []} rowLink={(c: any) => `/contracts/${c.id}`} columns={[
            { key: 'r', label: 'Contract', render: (c: any) => (<div><div className="num font-medium">{c.ref}</div><div className="text-xs text-muted">{c.name}</div></div>) },
            { key: 'c', label: 'Customer', render: (c: any) => c.customer_name },
            { key: 'l', label: 'Cover', render: (c: any) => (<div className="flex flex-wrap gap-1"><Badge tone="blue">{levelLabel(c.level)}</Badge>{c.ooh_cover ? <Badge tone="purple">OOH</Badge> : null}</div>) },
            { key: 's', label: 'Sites', render: (c: any) => <span className="num">{c.site_count}</span> },
            { key: 'p', label: 'Next PPM', render: (c: any) => <span className="num text-xs">{date(c.next_ppm_due)}</span> },
            { key: 'e', label: 'Ends', render: (c: any) => <span className={c.status === 'active' && c.ends_on <= soon ? 'num text-xs font-medium text-hot' : 'num text-xs'}>{date(c.ends_on)}</span> },
            { key: 'v', label: 'Annual value', render: (c: any) => <span className="num">{money(c.annual_value)}</span>, className: 'text-right' },
            { key: 'st', label: '', render: (c: any) => c.status !== 'active' && <Badge>{titleCase(c.status)}</Badge> },
          ]} />
        )}
      </Panel>
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="New maintenance contract"
        submitLabel="Create contract"
        initial={{ level: 'ppm_reactive', starts_on: new Date().toISOString().slice(0, 10), billing_cycle: 'quarterly', status: 'active' }}
        fields={[
          { name: 'customer_id', label: 'Customer', type: 'select', required: true, options: (customers.data ?? []).map((c) => [c.id, c.name]), wide: true },
          { name: 'name', label: 'Contract name', required: true, wide: true },
          { name: 'level', label: 'Cover level', type: 'select', required: true, options: [['ppm_only', 'PPM only'], ['ppm_reactive', 'PPM + reactive labour'], ['comprehensive', 'Comprehensive (parts & labour)']] },
          { name: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft'], ['active', 'Active']] },
          { name: 'starts_on', label: 'Start', type: 'date', required: true },
          { name: 'ends_on', label: 'End', type: 'date', required: true },
          { name: 'annual_value', label: 'Annual value (£)', type: 'number' },
          { name: 'billing_cycle', label: 'Billing', type: 'select', options: [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annually', 'Annually']] },
          { name: 'parts_limit', label: 'Parts limit per job (£)', type: 'number', hint: 'Comprehensive contracts' },
          { name: 'notice_days', label: 'Notice period (days)', type: 'number' },
          { name: 'ooh_cover', label: 'Out-of-hours cover', type: 'checkbox' },
          { name: 'auto_renew', label: 'Auto-renews', type: 'checkbox' },
          { name: 'notes', label: 'Notes / exclusions', type: 'textarea' },
        ]}
        onSubmit={async (v) => {
          const c = await post('/contracts', {
            ...v,
            annual_value: v.annual_value ?? 0,
            notice_days: v.notice_days ?? 90,
            labour_included: v.level !== 'ppm_only',
            parts_included: v.level === 'comprehensive',
            sla: v.level === 'ppm_only' ? [] : [
              { priority: 'P1', response_hours: 4, fix_hours: 24, basis: v.ooh_cover ? '24x7' : 'business' },
              { priority: 'P2', response_hours: 8, fix_hours: 32, basis: 'business' },
              { priority: 'P3', response_hours: 24, fix_hours: 72, basis: 'business' },
              { priority: 'P4', response_hours: 72, fix_hours: null, basis: 'business' },
            ],
          });
          navigate(`/contracts/${c.id}`);
        }}
      />
    </div>
  );
}
