import db from "@/app/lib/db";
import { crudRoutes } from "@/app/lib/crud";
import { PAYMENT_METHODS } from "@/app/lib/settings-defaults";

export const { GET, POST, PUT, DELETE } = crudRoutes({
  table: "payments",
  codeColumn: "payment_number",
  codePrefix: "PAY",
  fields: {
    invoice_id: { type: "number" },
    reference: { type: "string" },
    party: { type: "string", required: true },
    method: { type: "string", required: true, options: PAYMENT_METHODS },
    amount: { type: "number", required: true, min: 0.01 },
    paid_at: { type: "date" },
    status: { type: "string", options: ["Completed", "Pending", "Failed", "Refunded"] },
    notes: { type: "string" },
  },
  listSql: `
    SELECT p.*, i.invoice_number
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    ORDER BY p.paid_at DESC, p.id DESC
  `,
  onChange: async (rows) => {
    const invoiceIds = [...new Set(rows.map((row) => row.invoice_id).filter(Boolean))];

    for (const invoiceId of invoiceIds) {
      await db.query(
        `UPDATE invoices
         SET amount_paid = (
           SELECT COALESCE(SUM(amount), 0) FROM payments
           WHERE invoice_id = ? AND status = 'Completed'
         )
         WHERE id = ?`,
        [invoiceId, invoiceId]
      );
    }
  },
});
