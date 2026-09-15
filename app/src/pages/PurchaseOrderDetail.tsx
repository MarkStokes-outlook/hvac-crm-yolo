import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { errorText, post, useAction, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Badge, Button, ErrorNote, Input, KV, PageHeader, Panel, Spinner } from '../components/ui';
import { EntityLink } from '../components/domain';
import { date, dateTime, money2, titleCase } from '../lib/format';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const canEdit = perms(user).stock;
  const { data: po, isLoading } = useApi<any>(`/purchase-orders/${id}`);
  const [receipt, setReceipt] = useState<Record<number, string>>({});
  const [ref, setRef] = useState('');
  const order = useAction(() => post(`/purchase-orders/${id}/order`, { supplier_ref: ref || undefined }));
  const receive = useAction((lines: any[]) => post(`/purchase-orders/${id}/receive`, { lines }), () => setReceipt({}));
  if (isLoading || !po) return <Spinner />;
  const receiving = ['ordered', 'part_received'].includes(po.status) && canEdit;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title={<><span className="num">{po.po_no}</span> — {po.supplier_name}</>} actions={<Badge tone={po.status === 'received' ? 'green' : 'blue'}>{titleCase(po.status)}</Badge>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <Panel title="Lines" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2">Item</th><th className="px-2 text-right">Ordered</th><th className="px-2 text-right">Received</th><th className="px-2 text-right">Unit</th><th className="px-4 text-right">Total</th>{receiving && <th className="px-4">Receive now</th>}</tr></thead>
            <tbody>
              {po.lines.map((l: any) => (
                <tr key={l.id} className="border-b border-line/60">
                  <td className="px-4 py-2">{l.description}<div className="num text-xs text-muted">{l.sku}</div></td>
                  <td className="num px-2 text-right">{l.qty}</td>
                  <td className="num px-2 text-right">{l.qty_received}</td>
                  <td className="num px-2 text-right">{money2(l.unit_cost)}</td>
                  <td className="num px-4 text-right">{money2(l.qty * l.unit_cost)}</td>
                  {receiving && <td className="px-4"><Input type="number" className="h-8 w-20" placeholder={String(l.qty - l.qty_received)} value={receipt[l.id] ?? ''} onChange={(e) => setReceipt({ ...receipt, [l.id]: e.target.value })} disabled={l.qty_received >= l.qty} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted">Total {money2(po.total)} + VAT</span>
            {receiving && (
              <div className="flex gap-2">
                <Button onClick={() => receive.mutate(po.lines.map((l: any) => ({ line_id: l.id, qty: l.qty - l.qty_received })))}>Receive all</Button>
                <Button variant="primary" disabled={!Object.values(receipt).some((v) => Number(v) > 0)} onClick={() => receive.mutate(Object.entries(receipt).map(([lid, q]) => ({ line_id: Number(lid), qty: Number(q) })))}>Book in</Button>
              </div>
            )}
          </div>
          <div className="px-4 pb-3"><ErrorNote error={(receive.error || order.error) && errorText(receive.error ?? order.error)} /></div>
        </Panel>
        <aside className="space-y-4">
          <Panel title="Order">
            <KV cols={1} items={[
              ['Supplier', `${po.supplier_name}`],
              ['Supplier contact', [po.supplier_phone, po.supplier_email].filter(Boolean).join(' · ')],
              ['For job', po.job_no ? <EntityLink to={`/jobs/${po.job_id}`}>{po.job_no} {po.job_title}</EntityLink> : 'Stock replenishment'],
              ['Deliver to', `${titleCase(po.deliver_to)}${po.location_name ? ` — ${po.location_name}` : ''}`],
              ['Required by', date(po.required_by)],
              ['Ordered', po.ordered_at ? dateTime(po.ordered_at) : 'Not yet'],
              ['Supplier ref', po.supplier_ref],
              ['Raised by', po.raised_by_name],
            ]} />
          </Panel>
          {po.status === 'draft' && canEdit && (
            <Panel title="Place order">
              <Input placeholder="Supplier order reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <Button variant="primary" className="mt-2 w-full" loading={order.isPending} onClick={() => order.mutate(undefined)}>Mark as ordered</Button>
            </Panel>
          )}
          {po.job_no && po.status !== 'received' && <p className="text-xs text-muted">When everything is received, {po.job_no} is taken off "awaiting parts" and appears in the unscheduled list for a return visit.</p>}
        </aside>
      </div>
    </div>
  );
}
