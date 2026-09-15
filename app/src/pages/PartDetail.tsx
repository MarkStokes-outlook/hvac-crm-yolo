import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { errorText, post, put, useAction, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Button, ErrorNote, Input, KV, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { EntityLink } from '../components/domain';
import { dateTime, money2, titleCase } from '../lib/format';

export default function PartDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const canEdit = perms(user).stock;
  const { data: p, isLoading } = useApi<any>(`/parts/${id}`);
  const locations = useApi<any[]>('/stock/locations');
  const [mv, setMv] = useState({ from: '', to: '', qty: '1' });
  const move = useAction((b: any) => post('/stock/move', b), () => setMv({ from: '', to: '', qty: '1' }));
  const count = useAction((b: any) => put('/stock/level', b));
  if (isLoading || !p) return <Spinner />;
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title={p.name} subtitle={<span className="num">{p.sku} · {p.category}</span>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Panel title="Stock by location" bodyClass="p-0">
            <Table rows={p.levels} columns={[
              { key: 'l', label: 'Location', render: (l: any) => l.location_name },
              { key: 'q', label: 'Qty', render: (l: any) => canEdit ? <Input type="number" defaultValue={l.qty} className="h-8 w-20" onBlur={(e) => Number(e.target.value) !== l.qty && count.mutate({ part_id: p.id, location_id: l.location_id, qty: Number(e.target.value), note: 'Stock count' })} /> : <span className="num">{l.qty}</span> },
              { key: 'm', label: 'Min / max', render: (l: any) => <span className="num text-xs text-muted">{l.min_qty} / {l.max_qty}</span> },
            ]} />
            {canEdit && (
              <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-[1fr_1fr_80px_auto]">
                <Select value={mv.from} onChange={(e) => setMv({ ...mv, from: e.target.value })}><option value="">From…</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
                <Select value={mv.to} onChange={(e) => setMv({ ...mv, to: e.target.value })}><option value="">To…</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
                <Input type="number" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} />
                <Button disabled={!mv.from || !mv.to} onClick={() => move.mutate({ part_id: p.id, from_location_id: Number(mv.from), to_location_id: Number(mv.to), qty: Number(mv.qty), kind: 'transfer' })}>Transfer</Button>
                <div className="sm:col-span-4"><ErrorNote error={move.error && errorText(move.error)} /></div>
              </div>
            )}
          </Panel>
          <Panel title="Movements" bodyClass="p-0">
            <Table rows={p.movements} dense empty="No movements" columns={[
              { key: 'd', label: 'When', render: (m: any) => <span className="num text-xs">{dateTime(m.created_at)}</span> },
              { key: 'k', label: 'Type', render: (m: any) => titleCase(m.kind) },
              { key: 'q', label: 'Qty', render: (m: any) => <span className="num">{m.qty}</span> },
              { key: 'f', label: 'From → to', render: (m: any) => <span className="text-xs">{m.from_name ?? '—'} → {m.to_name ?? (m.job_no ? 'Job' : '—')}</span> },
              { key: 'r', label: 'Ref', render: (m: any) => <span className="text-xs">{m.job_no && <EntityLink to={`/jobs/${m.job_id}`}>{m.job_no}</EntityLink>} {m.po_no} {m.note}</span> },
              { key: 'u', label: 'By', render: (m: any) => <span className="text-xs">{m.user_name}</span> },
            ]} />
          </Panel>
        </div>
        <Panel title="Details">
          <KV cols={1} items={[
            ['Unit', p.unit],
            ['Cost', money2(p.unit_cost)],
            ['Sell', money2(p.sell_price)],
            ['Margin', `${Math.round((1 - p.unit_cost / p.sell_price) * 100)}%`],
            ['Preferred supplier', p.supplier_name],
            ['Supplier code', p.supplier_code],
          ]} />
        </Panel>
      </div>
    </div>
  );
}
