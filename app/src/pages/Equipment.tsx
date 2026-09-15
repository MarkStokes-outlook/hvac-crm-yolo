import { useState } from 'react';
import { useApi } from '../lib/api';
import { useMeta } from '../lib/auth';
import { Badge, Input, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { FgasBadge } from '../components/domain';
import { titleCase } from '../lib/format';

export default function Equipment() {
  const meta = useMeta();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [refrigerant, setRefrigerant] = useState('');
  const { data, isLoading } = useApi<any[]>(`/assets?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&refrigerant=${refrigerant}`);
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Equipment" subtitle="Every unit on every site — search by tag, make, model, serial or location" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Tag, make, model, serial…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
          <option value="">All categories</option>
          {meta?.asset_categories.map((c: string) => <option key={c}>{c}</option>)}
        </Select>
        <Select value={refrigerant} onChange={(e) => setRefrigerant(e.target.value)} className="w-auto">
          <option value="">Any refrigerant</option>
          {meta?.refrigerants.map((r: string) => <option key={r}>{r}</option>)}
        </Select>
      </div>
      <Panel bodyClass="p-0">
        {isLoading ? <Spinner /> : (
          <Table rows={data ?? []} rowLink={(a: any) => `/assets/${a.id}`} columns={[
            { key: 't', label: 'Tag', render: (a: any) => <span className="num font-medium">{a.tag}</span> },
            { key: 'c', label: 'Equipment', render: (a: any) => (<div><div>{a.category}</div><div className="text-xs text-muted">{a.manufacturer} {a.model}</div></div>) },
            { key: 's', label: 'Site', render: (a: any) => (<div className="text-xs"><div>{a.site_name}</div><div className="text-muted">{a.customer_name}</div></div>) },
            { key: 'r', label: 'Refrigerant', render: (a: any) => (a.refrigerant ? <span className="text-xs">{a.refrigerant} {a.refrigerant_kg}kg{a.fgas.co2e_tonnes != null && <div className="num text-muted">{a.fgas.co2e_tonnes} t CO₂e</div>}</span> : '—') },
            { key: 'i', label: 'Installed', render: (a: any) => <span className="num text-xs">{a.install_date?.slice(0, 4)}</span> },
            { key: 'st', label: 'Status', render: (a: any) => (<div className="flex flex-wrap gap-1">{a.status !== 'operational' && <Badge tone="orange">{titleCase(a.status)}</Badge>}<FgasBadge fgas={a.fgas} /></div>) },
          ]} />
        )}
      </Panel>
    </div>
  );
}
