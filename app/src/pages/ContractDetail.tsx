import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, errorText, patch, post, queryClient, useApi } from '../lib/api';
import { perms, useAuth, useMeta } from '../lib/auth';
import { useAiEntity } from '../components/AiPanel';
import { Badge, Button, ErrorNote, Input, KV, Modal, PageHeader, Panel, Select, Spinner, Table } from '../components/ui';
import { EntityLink, JobStatus, KIND_LABEL, SKILL_SHORT } from '../components/domain';
import { FormModal } from '../components/FormModal';
import { levelLabel } from './Contracts';
import { date, money, titleCase } from '../lib/format';

export default function ContractDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const canEdit = perms(user).contracts;
  const meta = useMeta();
  const { data: c, isLoading } = useApi<any>(`/contracts/${id}`);
  const [slaEdit, setSlaEdit] = useState(false);
  const [sitesEdit, setSitesEdit] = useState(false);
  const [planAdd, setPlanAdd] = useState(false);
  useAiEntity(c ? { type: 'contract', id: c.id, label: `${c.ref} ${c.customer_name}` } : null);
  const customerSites = useApi<any[]>(c && (sitesEdit || planAdd) ? `/sites?customer_id=${c.customer_id}` : null);
  const checklists = useApi<any[]>(planAdd ? '/checklists' : null);
  const engineers = useApi<any[]>(planAdd ? '/engineers' : null);
  if (isLoading || !c) return <Spinner />;
  const perf = c.performance;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="mb-1 text-sm"><EntityLink to={`/customers/${c.customer_id}`}>{c.customer_name}</EntityLink></div>
      <PageHeader
        title={<><span className="num text-muted">{c.ref}</span> {c.name}</>}
        actions={canEdit && c.status === 'active' && <Button onClick={() => patch(`/contracts/${c.id}`, { status: 'cancelled' }).then(() => queryClient.invalidateQueries())} variant="danger">Cancel contract</Button>}
      >
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={c.status === 'active' ? 'green' : 'neutral'}>{titleCase(c.status)}</Badge>
          <Badge tone="blue">{levelLabel(c.level)}</Badge>
          {c.ooh_cover ? <Badge tone="purple">Out-of-hours cover</Badge> : <Badge>Working hours only</Badge>}
        </div>
      </PageHeader>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title="Response & fix times" actions={canEdit && c.level !== 'ppm_only' && <Button size="sm" onClick={() => setSlaEdit(true)}>Edit</Button>}>
            {c.level === 'ppm_only' ? (
              <p className="text-sm text-muted">PPM-only contract. Reactive call-outs are chargeable and use standard response times.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5">Priority</th><th>Attend within</th><th>Fix within</th><th>Clock</th></tr></thead>
                <tbody>
                  {c.sla.map((t: any) => (
                    <tr key={t.priority} className="border-b border-line/60">
                      <td className="py-2 font-medium">{meta?.priorities[t.priority]?.label ?? t.priority}</td>
                      <td className="num">{t.response_hours} h</td>
                      <td className="num">{t.fix_hours ? `${t.fix_hours} h` : '—'}</td>
                      <td className="text-xs">{t.basis === '24x7' ? '24/7' : 'Working hours (Mon–Fri 08:00–17:30)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Planned maintenance schedule" bodyClass="p-0" actions={canEdit && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setPlanAdd(true)}>Add plan</Button>}>
            <Table rows={c.plans} empty="No PPM plans" columns={[
              { key: 'n', label: 'Plan', render: (p: any) => (<div><div>{p.name}</div><div className="text-xs text-muted">{p.site_name} · {p.asset_count} items</div></div>) },
              { key: 'f', label: 'Every', render: (p: any) => `${p.frequency_months} mo` },
              { key: 'h', label: 'Hours', render: (p: any) => <span className="num">{p.est_hours}</span> },
              { key: 's', label: 'Skills', render: (p: any) => <span className="text-xs">{p.required_skills.map((s: string) => SKILL_SHORT[s]).join(', ')}</span> },
              { key: 'e', label: 'Preferred', render: (p: any) => <span className="text-xs">{p.preferred_engineer_name}</span> },
              { key: 'd', label: 'Next due', render: (p: any) => <span className="num text-xs">{date(p.next_due_on)}</span> },
            ]} />
          </Panel>
          <Panel title="Recent jobs under this contract" bodyClass="p-0">
            <Table rows={c.recent_jobs} rowLink={(j: any) => `/jobs/${j.id}`} dense columns={[
              { key: 'n', label: 'Job', render: (j: any) => <span className="num">{j.job_no}</span> },
              { key: 't', label: 'Title', render: (j: any) => (<div>{j.title}<div className="text-xs text-muted">{j.site_name}</div></div>) },
              { key: 'k', label: 'Type', render: (j: any) => <span className="text-xs">{KIND_LABEL[j.kind]}</span> },
              { key: 's', label: 'Status', render: (j: any) => <JobStatus s={j.status} /> },
              { key: 'd', label: 'Logged', render: (j: any) => <span className="num text-xs">{date(j.created_at)}</span> },
            ]} />
          </Panel>
        </div>
        <aside className="space-y-4">
          <Panel title="Terms">
            <KV cols={1} items={[
              ['Term', `${date(c.starts_on)} – ${date(c.ends_on)}`],
              ['Annual value', money(c.annual_value)],
              ['Billing', titleCase(c.billing_cycle)],
              ['Reactive labour', c.labour_included ? 'Included' : 'Chargeable'],
              ['Parts', c.parts_included ? `Included up to ${money(c.parts_limit)} per job` : 'Chargeable'],
              ['Renewal', `${c.auto_renew ? 'Auto-renews' : 'Manual renewal'} · ${c.notice_days} days notice`],
              ['Account manager', c.account_manager_name],
            ]} />
            {c.notes && <p className="mt-3 border-t border-line pt-2 text-sm">{c.notes}</p>}
          </Panel>
          <Panel title="Sites covered" actions={canEdit && <Button size="sm" variant="ghost" onClick={() => setSitesEdit(true)}>Change</Button>}>
            {c.sites.map((s: any) => <div key={s.id} className="py-1 text-sm"><EntityLink to={`/sites/${s.id}`}>{s.name}</EntityLink> <span className="text-xs text-muted">{s.postcode} · {s.asset_count} items</span></div>)}
          </Panel>
          <Panel title="Performance this term">
            <KV cols={1} items={[
              ['Jobs', perf.jobs],
              ['Reactive call-outs', perf.reactive ?? 0],
              ['Attended within SLA', `${pct(perf.responded_in_sla ?? 0, perf.responded ?? 0)} (${perf.responded_in_sla ?? 0}/${perf.responded ?? 0})`],
              ['PPM visits completed', `${perf.ppm_done ?? 0} of ${perf.ppm ?? 0}`],
              ['Parts cost absorbed', money(perf.parts_cost)],
            ]} />
          </Panel>
        </aside>
      </div>

      <SlaModal open={slaEdit} onClose={() => setSlaEdit(false)} contract={c} />
      <Modal open={sitesEdit} onClose={() => setSitesEdit(false)} title="Sites covered" footer={<Button variant="primary" onClick={() => setSitesEdit(false)}>Done</Button>}>
        {customerSites.data?.map((s) => {
          const on = c.sites.some((x: any) => x.id === s.id);
          return (
            <label key={s.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={on} onChange={() => patch(`/contracts/${c.id}`, { site_ids: on ? c.sites.filter((x: any) => x.id !== s.id).map((x: any) => x.id) : [...c.sites.map((x: any) => x.id), s.id] }).then(() => queryClient.invalidateQueries())} />
              {s.name} <span className="text-muted">{s.postcode}</span>
            </label>
          );
        })}
      </Modal>
      <FormModal
        open={planAdd}
        onClose={() => setPlanAdd(false)}
        title="Add PPM plan"
        submitLabel="Add plan"
        initial={{ frequency_months: 6, est_hours: 3, next_due_on: new Date().toISOString().slice(0, 10) }}
        fields={[
          { name: 'site_id', label: 'Site', type: 'select', required: true, options: (customerSites.data ?? []).map((s) => [s.id, s.name]) },
          { name: 'name', label: 'Plan name', required: true, placeholder: 'e.g. 6-monthly AC service' },
          { name: 'frequency_months', label: 'Every (months)', type: 'number', required: true },
          { name: 'est_hours', label: 'Estimated hours', type: 'number' },
          { name: 'next_due_on', label: 'Next due', type: 'date', required: true },
          { name: 'checklist_template_id', label: 'Checklist', type: 'select', options: (checklists.data ?? []).map((t) => [t.id, t.name]) },
          { name: 'preferred_engineer_id', label: 'Preferred engineer', type: 'select', options: (engineers.data ?? []).map((e) => [e.id, e.name]) },
          { name: 'skills', label: 'Skills (comma separated codes)', placeholder: 'ac, ventilation' },
          { name: 'scheduling_notes', label: 'Scheduling notes', type: 'textarea' },
        ]}
        onSubmit={async (v) => {
          const { skills, ...rest } = v;
          const site = await api(`/sites/${v.site_id}`);
          await post('/ppm/plans', { ...rest, contract_id: c.id, required_skills: skills ? String(skills).split(',').map((s: string) => s.trim()).filter(Boolean) : [], asset_ids: site.assets.filter((a: any) => a.status !== 'decommissioned').map((a: any) => a.id) });
          queryClient.invalidateQueries();
        }}
      />
    </div>
  );
}

function SlaModal({ open, onClose, contract }: any) {
  const [rows, setRows] = useState<any[]>(contract.sla);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await patch(`/contracts/${contract.id}`, { sla: rows.map((r) => ({ priority: r.priority, response_hours: Number(r.response_hours), fix_hours: r.fix_hours ? Number(r.fix_hours) : null, basis: r.basis })) });
      queryClient.invalidateQueries();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Response & fix times" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.priority} className="grid grid-cols-[40px_1fr_1fr_1.3fr] items-center gap-2">
            <span className="font-medium">{r.priority}</span>
            <Input type="number" value={r.response_hours} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, response_hours: e.target.value } : x)))} aria-label="Attend hours" />
            <Input type="number" value={r.fix_hours ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, fix_hours: e.target.value } : x)))} aria-label="Fix hours" />
            <Select value={r.basis} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, basis: e.target.value } : x)))}>
              <option value="business">Working hours</option>
              <option value="24x7">24/7</option>
            </Select>
          </div>
        ))}
        <ErrorNote error={err} />
      </div>
    </Modal>
  );
}
