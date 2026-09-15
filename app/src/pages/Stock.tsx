import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import { api, errorText, post, queryClient, useAction, useApi } from '../lib/api';
import { perms, useAuth } from '../lib/auth';
import { Badge, Button, ErrorNote, Input, PageHeader, Panel, Select, Spinner, Table, Tabs } from '../components/ui';
import { EntityLink } from '../components/domain';
import { date, money, money2, titleCase } from '../lib/format';

export default function Stock() {
  const { user } = useAuth();
  const canEdit = perms(user).stock;
  const [tab, setTab] = useState<'parts' | 'locations' | 'low' | 'orders'>('parts');
  const [search, setSearch] = useState('');
  const parts = useApi<any[]>(tab === 'parts' ? `/parts?search=${encodeURIComponent(search)}` : null);
  const locations = useApi<any[]>('/stock/locations');
  const low = useApi<any[]>('/stock/low');
  const orders = useApi<any[]>(tab === 'orders' ? '/purchase-orders' : null);
  const [po, setPo] = useState(false);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Stock & purchasing" subtitle="Depot stores, van stock and supplier orders" actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPo(true)}>New purchase order</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'parts', label: 'Parts catalogue' },
        { id: 'locations', label: 'Depot & vans', count: locations.data?.length },
        { id: 'low', label: 'Below minimum', count: low.data?.length },
        { id: 'orders', label: 'Purchase orders' },
      ]} />
      {tab === 'parts' && (
        <>
          <Input placeholder="Search SKU, name, category…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 max-w-sm" />
          <Panel bodyClass="p-0">
            {parts.isLoading ? <Spinner /> : (
              <Table rows={parts.data ?? []} rowLink={(p: any) => `/stock/parts/${p.id}`} columns={[
                { key: 'n', label: 'Part', render: (p: any) => (<div><div>{p.name}</div><div className="num text-xs text-muted">{p.sku}</div></div>) },
                { key: 'c', label: 'Category', render: (p: any) => <span className="text-xs">{p.category}</span> },
                { key: 'd', label: 'Depot', render: (p: any) => <span className="num">{p.depot_qty}</span>, className: 'text-right' },
                { key: 'v', label: 'On vans', render: (p: any) => <span className="num">{p.van_qty}</span>, className: 'text-right' },
                { key: 'o', label: 'On order', render: (p: any) => <span className="num">{p.on_order || ''}</span>, className: 'text-right' },
                { key: 'cost', label: 'Cost', render: (p: any) => <span className="num">{money2(p.unit_cost)}</span>, className: 'text-right' },
                { key: 'sell', label: 'Sell', render: (p: any) => <span className="num">{money2(p.sell_price)}</span>, className: 'text-right' },
                { key: 's', label: 'Supplier', render: (p: any) => <span className="text-xs">{p.supplier_name}</span> },
              ]} />
            )}
          </Panel>
        </>
      )}
      {tab === 'locations' && <Locations locations={locations.data ?? []} canEdit={canEdit} />}
      {tab === 'low' && (
        <Panel bodyClass="p-0">
          <Table rows={low.data ?? []} empty="All stock above minimum" columns={[
            { key: 'l', label: 'Location', render: (r: any) => <span className="text-xs">{r.location_name}</span> },
            { key: 'n', label: 'Part', render: (r: any) => (<div>{r.name}<div className="num text-xs text-muted">{r.sku}</div></div>) },
            { key: 'q', label: 'Qty / min', render: (r: any) => <span className="num"><span className="font-medium text-scald">{r.qty}</span> / {r.min_qty}</span> },
            { key: 'o', label: 'On order', render: (r: any) => <span className="num">{r.on_order || '—'}</span> },
            { key: 's', label: 'Supplier', render: (r: any) => <span className="text-xs">{r.supplier_name}</span> },
          ]} />
        </Panel>
      )}
      {tab === 'orders' && (
        <Panel bodyClass="p-0">
          <Table rows={orders.data ?? []} rowLink={(o: any) => `/stock/purchase-orders/${o.id}`} columns={[
            { key: 'n', label: 'PO', render: (o: any) => <span className="num font-medium">{o.po_no}</span> },
            { key: 's', label: 'Supplier', render: (o: any) => o.supplier_name },
            { key: 'j', label: 'For job', render: (o: any) => o.job_no ? <EntityLink to={`/jobs/${o.job_id}`} className="num text-xs">{o.job_no}</EntityLink> : <span className="text-xs text-muted">Stock</span> },
            { key: 'r', label: 'Required by', render: (o: any) => <span className="num text-xs">{date(o.required_by)}</span> },
            { key: 't', label: 'Value', render: (o: any) => <span className="num">{money2(o.total)}</span>, className: 'text-right' },
            { key: 'st', label: 'Status', render: (o: any) => <Badge tone={o.status === 'received' ? 'green' : o.status === 'draft' ? 'neutral' : o.status === 'cancelled' ? 'neutral' : 'blue'}>{titleCase(o.status)}</Badge> },
          ]} />
        </Panel>
      )}
      {po && <NewPoModal onClose={() => setPo(false)} />}
    </div>
  );
}

function Locations({ locations, canEdit }: { locations: any[]; canEdit: boolean }) {
  const [sel, setSel] = useState<number | null>(null);
  const loc = useApi<any>(sel ? `/stock/locations/${sel}` : null);
  const [msg, setMsg] = useState<string | null>(null);
  const replenish = useAction((vid: number) => post(`/stock/locations/${vid}/replenish`), (r: any) => setMsg(`Moved ${r.moved.length} line(s) from depot${r.short.length ? `. Short at depot: ${r.short.map((s: any) => `${s.part} (${s.short})`).join(', ')}` : ''}.`));
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
      <Panel bodyClass="p-0">
        <ul className="divide-y divide-line">
          {locations.map((l) => (
            <li key={l.id}>
              <button onClick={() => { setSel(l.id); setMsg(null); }} className={`flex w-full items-center justify-between px-4 py-2.5 text-left ${sel === l.id ? 'bg-steel-50' : 'hover:bg-paper'}`}>
                <div>
                  <div className="text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-muted">{l.lines} lines · {money(l.value)}</div>
                </div>
                {l.below_min > 0 && <Badge tone="orange">{l.below_min} low</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={loc.data?.name ?? 'Select a location'} actions={canEdit && loc.data?.kind === 'van' && <Button size="sm" icon={<Truck className="size-3.5" />} loading={replenish.isPending} onClick={() => replenish.mutate(loc.data.id)}>Top up from depot</Button>} bodyClass="p-0">
        {msg && <div className="border-b border-line bg-ok-50 px-4 py-2 text-sm text-ok">{msg}</div>}
        {loc.data && (
          <Table rows={loc.data.items} dense columns={[
            { key: 'n', label: 'Part', render: (i: any) => (<div>{i.name}<div className="num text-xs text-muted">{i.sku}</div></div>) },
            { key: 'c', label: 'Category', render: (i: any) => <span className="text-xs">{i.category}</span> },
            { key: 'q', label: 'Qty', render: (i: any) => <span className={i.qty < i.min_qty ? 'num font-medium text-scald' : 'num'}>{i.qty}</span>, className: 'text-right' },
            { key: 'm', label: 'Min / max', render: (i: any) => <span className="num text-xs text-muted">{i.min_qty} / {i.max_qty}</span>, className: 'text-right' },
            { key: 'v', label: 'Value', render: (i: any) => <span className="num text-xs">{money2(i.qty * i.unit_cost)}</span>, className: 'text-right' },
          ]} />
        )}
      </Panel>
    </div>
  );
}

function NewPoModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const suppliers = useApi<any[]>('/suppliers');
  const low = useApi<any[]>('/stock/low');
  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const parts = useApi<any[]>(search.length >= 2 ? `/parts?search=${encodeURIComponent(search)}` : null);
  const [jobNo, setJobNo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const suggest = () => {
    const depotLow = (low.data ?? []).filter((r) => r.kind === 'depot' && String(r.preferred_supplier_id) === supplier);
    setLines(depotLow.map((r) => ({ part_id: r.part_id, description: r.name, qty: Math.max(1, r.max_qty - r.qty - r.on_order), unit_cost: r.unit_cost })));
  };
  const create = async (place: boolean) => {
    try {
      let job_id: number | undefined;
      if (jobNo) {
        const jobs = await api<any[]>(`/jobs?search=${encodeURIComponent(jobNo)}&status=`);
        job_id = jobs.find((j: any) => j.job_no.toLowerCase() === jobNo.toLowerCase())?.id;
        if (!job_id) return setErr(`Job ${jobNo} not found`);
      }
      const po = await post('/purchase-orders', { supplier_id: Number(supplier), job_id, lines: lines.map((l) => ({ part_id: l.part_id, description: l.description, qty: Number(l.qty), unit_cost: Number(l.unit_cost) })), place_order: place });
      queryClient.invalidateQueries();
      navigate(`/stock/purchase-orders/${po.id}`);
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/40 p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="border-b border-line px-5 py-3 font-semibold text-navy-900">New purchase order</div>
        <div className="space-y-3 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
            <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Supplier…</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Input placeholder="For job (J-00123)" value={jobNo} onChange={(e) => setJobNo(e.target.value)} />
            <Button disabled={!supplier} onClick={suggest}>Add low stock lines</Button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="w-20">Qty</th><th className="w-28">Unit cost</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1"><Input value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                  <td><Input type="number" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><Input type="number" value={l.unit_cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))} /></td>
                  <td><button className="px-2 text-muted hover:text-scald" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="relative">
            <Input placeholder="Add catalogue part…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {parts.data && parts.data.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-line bg-white shadow-lg">
                {parts.data.slice(0, 8).map((p) => <li key={p.id}><button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-steel-50" onClick={() => { setLines([...lines, { part_id: p.id, description: p.name, qty: 1, unit_cost: p.unit_cost }]); setSearch(''); }}>{p.name} <span className="text-xs text-muted">{p.sku}</span></button></li>)}
              </ul>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { description: '', qty: 1, unit_cost: 0 }])}>+ Non-catalogue item</Button>
          <ErrorNote error={err} />
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!supplier || !lines.length} onClick={() => create(false)}>Save draft</Button>
          <Button variant="primary" disabled={!supplier || !lines.length} onClick={() => create(true)}>Place order</Button>
        </div>
      </div>
    </div>
  );
}
