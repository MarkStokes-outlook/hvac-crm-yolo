import { useEffect, useState } from 'react';
import { errorText, put, queryClient, useApi } from '../lib/api';
import { useMeta } from '../lib/auth';
import { Badge, Button, ErrorNote, Field, Input, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { dateTime, titleCase } from '../lib/format';

const RATE_LABELS: Record<string, string> = {
  labour_normal: 'Labour — normal hours (£/h)',
  labour_overtime: 'Labour — evenings & Saturday (£/h)',
  labour_sunday_bh: 'Labour — Sunday & bank holiday (£/h)',
  callout_normal: 'Call-out — normal hours (£)',
  callout_ooh: 'Call-out — out of hours (£)',
  apprentice: 'Apprentice labour (£/h)',
  mileage_per_mile: 'Mileage (£/mile)',
  materials_markup_pct: 'Materials markup (%)',
  vat_pct: 'VAT (%)',
};

export default function Settings() {
  const { data } = useApi<any>('/settings');
  const audit = useApi<any[]>('/audit');
  const meta = useMeta();
  const [rates, setRates] = useState<any>(null);
  const [sla, setSla] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (data) {
      setRates(data.rates);
      setSla(data.default_sla);
    }
  }, [data]);
  if (!rates || !sla) return <Spinner />;
  const save = async (key: string, value: any) => {
    setErr(null);
    try {
      await put(`/settings/${key}`, value);
      queryClient.invalidateQueries();
      setMsg('Saved');
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Settings" actions={msg && <Badge tone="green">{msg}</Badge>} />
      <ErrorNote error={err} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Rate card" actions={<Button size="sm" variant="primary" onClick={() => save('rates', Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v)])))}>Save</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.keys(RATE_LABELS).map((k) => (
              <Field key={k} label={RATE_LABELS[k]}><Input type="number" step="any" value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} /></Field>
            ))}
          </div>
        </Panel>
        <Panel title="Standard response times (no contract)" actions={<Button size="sm" variant="primary" onClick={() => save('default_sla', Object.fromEntries(Object.entries(sla).map(([k, v]: any) => [k, { ...v, response_hours: Number(v.response_hours), fix_hours: v.fix_hours ? Number(v.fix_hours) : null }])))}>Save</Button>}>
          <p className="mb-3 text-sm text-muted">Used for customers without a reactive contract. Contract terms are set on each contract.</p>
          {Object.entries(sla).map(([p, t]: any) => (
            <div key={p} className="mb-2 grid grid-cols-[40px_1fr_1fr_1.2fr] items-center gap-2">
              <span className="font-medium">{p}</span>
              <Input type="number" value={t.response_hours} onChange={(e) => setSla({ ...sla, [p]: { ...t, response_hours: e.target.value } })} aria-label={`${p} attend hours`} />
              <Input type="number" value={t.fix_hours ?? ''} onChange={(e) => setSla({ ...sla, [p]: { ...t, fix_hours: e.target.value } })} aria-label={`${p} fix hours`} />
              <Select value={t.basis} onChange={(e) => setSla({ ...sla, [p]: { ...t, basis: e.target.value } })}><option value="business">Working hours</option><option value="24x7">24/7</option></Select>
            </div>
          ))}
          <div className="text-xs text-muted">Columns: attend within (h), fix within (h), clock</div>
        </Panel>
        <Panel title="Assistant">
          <p className="text-sm">{meta?.ai?.configured ? <>Connected — model <span className="num">{meta.ai.model}</span>.</> : <>Not configured. Add <code>ANTHROPIC_API_KEY</code> to <code>app/.env</code> and restart. Triage falls back to keyword rules until then.</>}</p>
        </Panel>
        <Panel title="Recent activity (audit)" bodyClass="p-0 max-h-96 overflow-y-auto">
          <Table rows={audit.data ?? []} dense columns={[
            { key: 'w', label: 'When', render: (a: any) => <span className="num text-xs">{dateTime(a.created_at)}</span> },
            { key: 'u', label: 'Who', render: (a: any) => <span className="text-xs">{a.user_name ?? 'System'}{a.via_ai ? ' (assistant)' : ''}</span> },
            { key: 'a', label: 'What', render: (a: any) => <span className="text-xs">{titleCase(a.entity_type)} #{a.entity_id} {titleCase(a.action)} {a.detail}</span> },
          ]} />
        </Panel>
      </div>
    </div>
  );
}
