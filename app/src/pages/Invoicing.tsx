import { useState } from 'react';
import { Download } from 'lucide-react';
import { errorText, patch, post, useAction, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Badge, Button, ErrorNote, Input, PageHeader, Panel, Spinner, Table } from '../components/ui';
import { EntityLink, KIND_LABEL } from '../components/domain';
import { date, money2, titleCase } from '../lib/format';

export default function Invoicing() {
  const { user } = useAuth();
  const canInvoice = perms(user).invoicing;
  const { data, isLoading } = useApi<any[]>('/invoicing');
  const [refs, setRefs] = useState<Record<number, string>>({});
  const invoice = useAction(({ id, ...b }: any) => post(`/jobs/${id}/invoice`, b));
  const close = useAction((id: number) => patch(`/jobs/${id}`, { status: 'closed' }));

  const exportCsv = () => {
    const rows = [['Job', 'Customer', 'Site', 'Customer PO', 'Type', 'Completed', 'Labour hours', 'Labour £', 'Call-out £', 'Parts £', 'Total net £']];
    for (const j of data ?? []) rows.push([j.job_no, j.customer_name, j.site_name, j.customer_ref ?? '', j.charge_type, j.completed_at?.slice(0, 10) ?? '', j.valuation.labour_hours, j.valuation.labour_value, j.valuation.callout_value, j.valuation.parts_value, j.valuation.total_chargeable ?? '']);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `frostline-ready-to-invoice-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Ready to invoice"
        subtitle="Completed chargeable and quoted work. Invoices are raised in the accounts package — export this list, then record invoice numbers here."
        actions={<Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!data?.length}>Export CSV</Button>}
      />
      <ErrorNote error={(invoice.error || close.error) && errorText(invoice.error ?? close.error)} />
      <Panel bodyClass="p-0">
        {isLoading ? <Spinner /> : (
          <Table rows={data ?? []} empty="Nothing waiting to be invoiced" columns={[
            { key: 'n', label: 'Job', render: (j: any) => <EntityLink to={`/jobs/${j.id}`} className="num">{j.job_no}</EntityLink> },
            { key: 't', label: 'Work', render: (j: any) => (<div className="min-w-[220px]"><div>{j.title}</div><div className="text-xs text-muted">{j.customer_name} · {j.site_name}</div></div>) },
            { key: 'k', label: 'Type', render: (j: any) => <span className="text-xs">{KIND_LABEL[j.kind]} · {titleCase(j.charge_type)}{j.quote_no && <div>Quote {j.quote_no}</div>}</span> },
            { key: 'po', label: 'Customer PO', render: (j: any) => (j.customer_ref ? <span className="num text-xs">{j.customer_ref}</span> : j.po_required ? <Badge tone="red">PO missing</Badge> : <span className="text-xs text-muted">—</span>) },
            { key: 'c', label: 'Completed', render: (j: any) => <span className="num text-xs">{date(j.completed_at)}</span> },
            { key: 'v', label: 'Value', render: (j: any) => (<div className="num text-right"><div className="font-medium">{money2(j.valuation.total_chargeable)}</div><div className="text-xs text-muted">{j.valuation.labour_hours}h · parts {money2(j.valuation.parts_value)}</div>{j.valuation.exceeds_nte && <Badge tone="red">Over NTE</Badge>}</div>), className: 'text-right' },
            { key: 'st', label: 'Status', render: (j: any) => (j.status === 'completed' ? <Button size="sm" onClick={() => close.mutate(j.id)}>Review & close</Button> : <Badge tone="green">Ready</Badge>) },
            { key: 'i', label: 'Invoice no.', render: (j: any) => canInvoice && j.status === 'closed' && (
              <div className="flex gap-1">
                <Input className="h-8 w-28" placeholder="INV-" value={refs[j.id] ?? ''} onChange={(e) => setRefs({ ...refs, [j.id]: e.target.value })} />
                <Button size="sm" disabled={!refs[j.id]} onClick={() => invoice.mutate({ id: j.id, invoice_ref: refs[j.id], invoice_value: j.valuation.total_chargeable ?? undefined })}>Save</Button>
              </div>
            ) },
          ]} />
        )}
      </Panel>
    </div>
  );
}
