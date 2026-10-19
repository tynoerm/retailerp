import { queryRows, type Row } from "./crud";

export type InvoiceStatus = "Paid" | "Partially Paid" | "Overdue" | "Pending";

export function withStatus(invoice: Row) {
  const total = Number(invoice.total);
  const paid = Number(invoice.amount_paid);
  const today = new Date().toISOString().slice(0, 10);

  const status: InvoiceStatus =
    total > 0 && paid >= total
      ? "Paid"
      : String(invoice.due_date) < today
        ? "Overdue"
        : paid > 0
          ? "Partially Paid"
          : "Pending";

  return { ...invoice, balance: Math.max(total - paid, 0), status };
}

export async function getInvoice(id: number) {
  const [invoice] = await queryRows("SELECT * FROM invoices WHERE id = ?", [id]);
  if (!invoice) return null;

  const [items, customers] = await Promise.all([
    queryRows("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", [id]),
    invoice.customer_id
      ? queryRows("SELECT name, email, phone, address FROM customers WHERE id = ?", [invoice.customer_id])
      : Promise.resolve([]),
  ]);

  return { ...withStatus(invoice), items, customer: customers[0] ?? null };
}
