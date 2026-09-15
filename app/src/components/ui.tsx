import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Inputs are full width unless the caller sets a width. */
const widthOf = (className?: string) => (className && /(^|\s)w-/.test(className) ? '' : 'w-full');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'navy';
const variants: Record<Variant, string> = {
  primary: 'bg-steel-600 text-white hover:bg-navy-700 border-transparent',
  navy: 'bg-navy-800 text-white hover:bg-navy-700 border-transparent',
  secondary: 'bg-white text-ink border-line-strong hover:border-steel-500 hover:text-navy-800',
  ghost: 'bg-transparent text-navy-800 border-transparent hover:bg-steel-50',
  danger: 'bg-white text-scald border-line-strong hover:border-scald hover:bg-scald-50',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : size === 'lg' ? 'h-12 px-5 text-base' : 'h-9 px-3.5 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);

export const inputCls = 'rounded-md border border-line-strong bg-white px-2.5 h-9 text-sm text-ink placeholder:text-muted/70 focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-steel-100 disabled:bg-paper';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => <input ref={ref} className={cx(inputCls, widthOf(className), className)} {...rest} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...rest }, ref) => (
  <textarea ref={ref} className={cx(inputCls, 'h-auto py-2 leading-relaxed', widthOf(className), className)} {...rest} />
));
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={cx(inputCls, 'pr-7', widthOf(className), className)} {...rest}>
    {children}
  </select>
));

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Panel({ title, actions, children, className, bodyClass, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={cx('rounded-lg border border-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[15px] font-semibold text-navy-900">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold text-navy-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'orange' | 'red' | 'navy' | 'purple';
const tones: Record<Tone, string> = {
  neutral: 'bg-paper text-muted border-line',
  blue: 'bg-steel-50 text-steel-600 border-steel-100',
  green: 'bg-ok-50 text-ok border-ok/20',
  amber: 'bg-warn-50 text-[#a1650f] border-warm/30',
  orange: 'bg-hot-50 text-[#b2521c] border-hot/30',
  red: 'bg-scald-50 text-scald border-scald/25',
  navy: 'bg-navy-800 text-white border-navy-800',
  purple: 'bg-[#f1edfb] text-[#5b3fa8] border-[#ddd3f5]',
};
export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-px text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-md border border-scald/30 bg-scald-50 px-3 py-2 text-sm text-scald">{msg}</div>;
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={cx('w-full rounded-lg bg-white shadow-xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-base font-semibold text-navy-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-paper" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap', value === t.id ? 'border-steel-600 font-medium text-navy-900' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
          {t.count != null && <span className="num ml-1.5 rounded bg-paper px-1 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Simple data table. Columns render cells; rows can link. */
export function Table<T>({ rows, columns, rowLink, empty = 'Nothing to show', dense }: { rows: T[]; columns: { key: string; label: ReactNode; render: (r: T) => ReactNode; className?: string }[]; rowLink?: (r: T) => string; empty?: string; dense?: boolean }) {
  const navigate = useNavigate();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] text-muted">
            {columns.map((c) => (
              <th key={c.key} className={cx('px-3 py-2 font-medium whitespace-nowrap', c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              onClick={(e) => {
                if (!rowLink || (e.target as HTMLElement).closest('a,button,input,select')) return;
                navigate(rowLink(r));
              }}
              className={cx('border-b border-line/70 last:border-0', rowLink && 'cursor-pointer hover:bg-steel-50/60')}
            >
              {columns.map((c, ci) => (
                <td key={c.key} className={cx('px-3 align-top', dense ? 'py-1.5' : 'py-2.5', c.className)}>
                  {rowLink && ci === 0 ? (
                    <Link to={rowLink(r)} className="hover:underline">
                      {c.render(r)}
                    </Link>
                  ) : (
                    c.render(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: number }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-2.5 text-sm', cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
      {items
        .filter(([, v]) => v !== undefined)
        .map(([k, v], i) => (
          <div key={i} className="min-w-0">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 break-words text-ink">{v ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Stat({ label, value, tone, to, sub }: { label: string; value: ReactNode; tone?: 'hot' | 'scald' | 'cool' | 'ok'; to?: string; sub?: ReactNode }) {
  const bar = tone === 'scald' ? 'bg-scald' : tone === 'hot' ? 'bg-hot' : tone === 'ok' ? 'bg-ok' : 'bg-cool';
  const body = (
    <div className="relative h-full overflow-hidden rounded-lg border border-line bg-white px-4 py-3 hover:border-line-strong">
      <span className={cx('absolute top-0 bottom-0 left-0 w-1', bar)} />
      <div className="text-[13px] text-muted">{label}</div>
      <div className="num mt-0.5 text-[28px] leading-none font-semibold text-navy-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
