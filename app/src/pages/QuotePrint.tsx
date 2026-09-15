import { useParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { Spinner } from '../components/ui';
import { date, money2, titleCase } from '../lib/format';

/** Printable customer quotation — use the browser's Print → Save as PDF. */
export default function QuotePrint() {
  const { id } = useParams();
  const { data: q } = useApi<any>(`/quotes/${id}`);
  if (!q) return <Spinner />;
  const groups = ['equipment', 'materials', 'labour', 'access', 'subcontract', 'other'].map((k) => ({ k, lines: q.lines.filter((l: any) => l.kind === k) })).filter((g) => g.lines.length);
  return (
    <div className="min-h-full bg-paper py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-[800px] bg-white p-12 shadow print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-4 flex justify-end print:hidden">
          <button onClick={() => window.print()} className="rounded-md bg-navy-800 px-4 py-2 text-sm text-white">Print / save as PDF</button>
        </div>
        <header className="flex items-start justify-between border-b-2 border-navy-800 pb-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="size-12" />
            <div>
              <div className="text-xl font-semibold text-navy-900">Frostline Mechanical Services Ltd</div>
              <div className="text-xs text-muted">Commercial HVAC installation, maintenance & repair · Bury, Greater Manchester</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold text-navy-900">Quotation</div>
            <div className="num text-sm">{q.quote_no}</div>
            <div className="text-xs text-muted">Date {date(q.sent_at ?? q.created_at)}</div>
            <div className="text-xs text-muted">Valid until {date(q.valid_until)}</div>
          </div>
        </header>
        <section className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-xs text-muted">Prepared for</div>
            <div className="font-medium">{q.customer_name}</div>
            {q.contact_name && <div>FAO {q.contact_name}</div>}
            <div className="text-muted">{q.billing_address} {q.billing_postcode}</div>
          </div>
          {q.site_name && (
            <div>
              <div className="text-xs text-muted">Site</div>
              <div className="font-medium">{q.site_name}</div>
              <div className="text-muted">{q.site_address}, {q.site_town} {q.site_postcode}</div>
            </div>
          )}
        </section>
        <h1 className="mt-8 text-lg font-semibold text-navy-900">{q.title}</h1>
        {q.scope && <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{q.scope}</div>}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-navy-800 text-left text-xs text-muted"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Unit</th><th className="py-2 text-right">Total</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g.k}><td colSpan={4} className="pt-3 pb-1 text-xs font-semibold text-navy-800">{titleCase(g.k)}</td></tr>,
              ...g.lines.map((l: any) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-1.5">{l.description}</td>
                  <td className="num py-1.5 text-right">{l.qty}</td>
                  <td className="num py-1.5 text-right">{money2(l.unit_price)}</td>
                  <td className="num py-1.5 text-right">{money2(l.qty * l.unit_price)}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>Net</span><span className="num">{money2(q.totals.net)}</span></div>
          <div className="flex justify-between"><span>VAT @ 20%</span><span className="num">{money2(q.totals.vat)}</span></div>
          <div className="flex justify-between border-t border-navy-800 pt-1 font-semibold"><span>Total</span><span className="num">{money2(q.totals.gross)}</span></div>
        </div>
        {q.exclusions && (
          <section className="mt-8 text-xs text-muted">
            <div className="mb-1 font-semibold text-ink">Exclusions</div>
            <p className="whitespace-pre-wrap">{q.exclusions}</p>
          </section>
        )}
        <section className="mt-6 text-xs text-muted">
          <p>Payment terms as per account. Works carried out in accordance with F-Gas Regulations and current HSE guidance. Equipment warranties per manufacturer terms, with 12 months workmanship warranty.</p>
          <p className="mt-4">To accept, please return a signed copy or your official order quoting {q.quote_no}.</p>
          <p className="mt-6">Prepared by {q.prepared_by_name}{q.prepared_by_title ? `, ${q.prepared_by_title}` : ''}</p>
        </section>
      </div>
    </div>
  );
}
