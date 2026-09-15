import { useEffect, useState } from 'react';
import { errorText } from '../lib/api';
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from './ui';

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox' | 'email' | 'datetime-local';
  options?: [string | number, string][];
  required?: boolean;
  hint?: string;
  wide?: boolean;
  placeholder?: string;
}

/** Generic create/edit form in a modal. Values are coerced by field type on save. */
export function FormModal({ open, onClose, title, fields, initial, onSubmit, submitLabel = 'Save', onValuesChange }: { onValuesChange?: (values: Record<string, any>) => void; open: boolean; onClose: () => void; title: string; fields: FieldSpec[]; initial?: Record<string, any>; onSubmit: (values: Record<string, any>) => Promise<unknown>; submitLabel?: string }) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    const missing = fields.filter((f) => f.required && (values[f.name] === undefined || values[f.name] === ''));
    if (missing.length) return setError(`Please fill in: ${missing.map((m) => m.label).join(', ')}`);
    const out: Record<string, any> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === 'checkbox') out[f.name] = !!v;
      else if (v === '' || v === undefined) out[f.name] = f.required ? undefined : null;
      else if (f.type === 'number') out[f.name] = Number(v);
      else if (f.type === 'select' && typeof f.options?.[0]?.[0] === 'number') out[f.name] = Number(v);
      else out[f.name] = v;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(out);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{submitLabel}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const v = values[f.name] ?? '';
          const set = (x: any) => {
            const next = { ...values, [f.name]: x };
            setValues(next);
            onValuesChange?.(next);
          };
          if (f.type === 'checkbox')
            return (
              <label key={f.name} className="flex items-center gap-2 text-sm sm:col-span-1">
                <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(e.target.checked)} /> {f.label}
              </label>
            );
          return (
            <Field key={f.name} label={f.label + (f.required ? ' *' : '')} hint={f.hint} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
              {f.type === 'textarea' ? (
                <Textarea rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
              ) : f.type === 'select' ? (
                <Select value={v} onChange={(e) => set(e.target.value)}>
                  <option value="">—</option>
                  {f.options?.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </Select>
              ) : (
                <Input type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
              )}
            </Field>
          );
        })}
      </div>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  );
}
