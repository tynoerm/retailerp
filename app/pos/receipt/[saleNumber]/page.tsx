import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PrintToolbar from "@/app/components/PrintToolbar";
import { queryRows } from "@/app/lib/crud";
import { ensureSchema } from "@/app/lib/db";
import { money } from "@/app/lib/format";
import { getSettings } from "@/app/lib/settings";

type Sale = {
  id: number;
  sale_number: string;
  customer: string;
  payment_method: string;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  total: number;
  amount_paid: number;
  change_amount: number;
  status: string;
  created_at: string;
};

type SaleItem = { id: number; product_name: string; sku: string | null; quantity: number; unit_price: number; line_total: number };

export const metadata: Metadata = { title: "Receipt • RetailERP" };

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "text-sm font-bold" : ""}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default async function ReceiptPage(props: PageProps<"/pos/receipt/[saleNumber]">) {
  const { saleNumber } = await props.params;
  const { autoprint } = await props.searchParams;

  await ensureSchema();

  const [[sale], settings] = await Promise.all([
    queryRows<Sale>("SELECT * FROM sales WHERE sale_number = ? LIMIT 1", [saleNumber]),
    getSettings(),
  ]);

  if (!sale) notFound();

  const items = await queryRows<SaleItem>("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", [sale.id]);
  const fmt = (value: number) => money(value, settings.currency);

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <style>{"@page { size: 80mm auto; margin: 4mm; }"}</style>

      <PrintToolbar autoPrint={autoprint !== undefined} />

      <article className="mx-auto w-[80mm] bg-white p-5 font-mono text-[11px] leading-relaxed text-black shadow-lg print:w-full print:p-0 print:shadow-none">
        <header className="text-center">
          <p className="text-base font-bold uppercase">{settings.businessName}</p>
          <p>{settings.address}</p>
          <p>{settings.phone}</p>
        </header>

        <div className="my-3 border-t border-dashed border-black" />

        <Row label="Receipt" value={sale.sale_number} />
        <Row label="Date" value={sale.created_at.slice(0, 16)} />
        <Row label="Customer" value={sale.customer} />
        {sale.status !== "COMPLETED" && <Row label="Status" value={sale.status} bold />}

        <div className="my-3 border-t border-dashed border-black" />

        {items.map((item) => (
          <div key={item.id} className="mb-1.5">
            <p className="font-semibold">{item.product_name}</p>
            <div className="flex justify-between">
              <span>
                {item.quantity} x {fmt(item.unit_price)}
              </span>
              <span>{fmt(item.line_total)}</span>
            </div>
          </div>
        ))}

        <div className="my-3 border-t border-dashed border-black" />

        <Row label="Subtotal" value={fmt(sale.subtotal)} />
        {sale.discount > 0 && <Row label="Discount" value={`-${fmt(sale.discount)}`} />}
        <Row label={`Tax (${sale.tax_rate}%)`} value={fmt(sale.tax)} />
        <Row label="TOTAL" value={fmt(sale.total)} bold />

        <div className="my-3 border-t border-dashed border-black" />

        <Row label={`Paid (${sale.payment_method})`} value={fmt(sale.amount_paid || sale.total)} />
        {sale.change_amount > 0 && <Row label="Change" value={fmt(sale.change_amount)} />}

        <div className="my-3 border-t border-dashed border-black" />

        <p className="text-center">{settings.receiptFooter}</p>
        <p className="mt-1 text-center text-[10px]">Items: {items.reduce((s, i) => s + Number(i.quantity), 0)}</p>
      </article>
    </div>
  );
}
