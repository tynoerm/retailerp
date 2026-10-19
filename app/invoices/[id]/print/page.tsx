import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import PrintToolbar from "@/app/components/PrintToolbar";
import { ensureSchema } from "@/app/lib/db";
import { formatDate, money } from "@/app/lib/format";
import { getInvoice } from "@/app/lib/invoices";
import { getSettings } from "@/app/lib/settings";

type InvoiceItem = { id: number; description: string; quantity: number; unit_price: number; line_total: number };

type Invoice = {
  invoice_number: string;
  customer_name: string;
  issued_date: string;
  due_date: string;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance: number;
  notes: string | null;
  status: string;
  items: InvoiceItem[];
  customer: { email: string | null; phone: string | null; address: string | null } | null;
};

export const metadata: Metadata = { title: "Invoice • RetailERP" };

export default async function InvoicePrintPage(props: PageProps<"/invoices/[id]/print">) {
  const { id } = await props.params;
  const { autoprint } = await props.searchParams;
  const invoiceId = Number(id);

  if (!Number.isInteger(invoiceId) || invoiceId <= 0) notFound();

  await ensureSchema();

  const [invoice, settings] = await Promise.all([
    getInvoice(invoiceId) as Promise<Invoice | null>,
    getSettings(),
  ]);

  if (!invoice) notFound();

  const fmt = (value: number) => money(value, settings.currency);
  const statusColor =
    invoice.status === "Paid" ? "text-emerald-600 border-emerald-300" :
    invoice.status === "Overdue" ? "text-red-600 border-red-300" :
    "text-amber-600 border-amber-300";

  return (
    <div className="min-h-screen bg-slate-100 py-8 text-slate-800 print:bg-white print:py-0">
      <PrintToolbar autoPrint={autoprint !== undefined} />

      <article className="mx-auto w-full max-w-[210mm] bg-white p-12 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-[#0F2A3B] pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1C9A9A] text-white">
              <ShoppingBag size={24} />
            </div>
            <div>
              <p className="text-xl font-bold text-[#0F2A3B]">{settings.businessName}</p>
              <p className="text-xs text-slate-500">{settings.address}</p>
              <p className="text-xs text-slate-500">{settings.phone} • {settings.email}</p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-3xl font-bold tracking-tight text-[#0F2A3B]">INVOICE</p>
            <p className="mt-1 font-semibold text-slate-600">{invoice.invoice_number}</p>
            <span className={`mt-2 inline-block rounded-full border px-3 py-0.5 text-xs font-bold uppercase ${statusColor}`}>
              {invoice.status}
            </span>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Bill To</p>
            <p className="mt-2 font-semibold text-slate-800">{invoice.customer_name}</p>
            {invoice.customer?.address && <p className="text-slate-600">{invoice.customer.address}</p>}
            {invoice.customer?.phone && <p className="text-slate-600">{invoice.customer.phone}</p>}
            {invoice.customer?.email && <p className="text-slate-600">{invoice.customer.email}</p>}
          </div>

          <dl className="grid grid-cols-2 gap-y-1 self-start text-right">
            <dt className="text-slate-500">Issue date</dt>
            <dd className="font-semibold">{formatDate(invoice.issued_date)}</dd>
            <dt className="text-slate-500">Due date</dt>
            <dd className="font-semibold">{formatDate(invoice.due_date)}</dd>
            <dt className="text-slate-500">Amount due</dt>
            <dd className="font-bold text-[#0F2A3B]">{fmt(invoice.balance)}</dd>
          </dl>
        </section>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="bg-[#0F2A3B] text-left text-xs uppercase tracking-wide text-white print:bg-[#0F2A3B]">
              <th className="px-4 py-3 font-semibold">#</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 text-right font-semibold">Qty</th>
              <th className="px-4 py-3 text-right font-semibold">Unit Price</th>
              <th className="px-4 py-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invoice.items.map((item, index) => (
              <tr key={item.id}>
                <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                <td className="px-4 py-3">{item.description}</td>
                <td className="px-4 py-3 text-right">{item.quantity}</td>
                <td className="px-4 py-3 text-right">{fmt(item.unit_price)}</td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-6 flex justify-end">
          <dl className="w-72 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd>{fmt(invoice.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Tax ({invoice.tax_rate}%)</dt>
              <dd>{fmt(invoice.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd>{fmt(invoice.total)}</dd>
            </div>
            <div className="flex justify-between text-emerald-700">
              <dt>Paid</dt>
              <dd>−{fmt(invoice.amount_paid)}</dd>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-100 px-3 py-2 text-base font-bold text-[#0F2A3B]">
              <dt>Balance Due</dt>
              <dd>{fmt(invoice.balance)}</dd>
            </div>
          </dl>
        </section>

        {invoice.notes && (
          <section className="mt-8 text-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Notes</p>
            <p className="mt-2 whitespace-pre-line text-slate-600">{invoice.notes}</p>
          </section>
        )}

        <footer className="mt-12 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          {settings.receiptFooter}
        </footer>
      </article>
    </div>
  );
}
