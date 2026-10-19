import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import db from "@/app/lib/db";
import { ApiError, handle, pickFields, queryRows, requireId, type Row } from "@/app/lib/crud";
import { getInvoice, withStatus } from "@/app/lib/invoices";
import { withTransaction } from "@/app/lib/stock";

type ItemInput = { description?: unknown; quantity?: unknown; unit_price?: unknown };

const fields = {
  customer_id: { type: "number" },
  customer_name: { type: "string", required: true },
  issued_date: { type: "date", required: true },
  due_date: { type: "date", required: true },
  tax_rate: { type: "number", min: 0 },
  notes: { type: "string" },
} as const;

function parseItems(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError("An invoice needs at least one line item");
  }

  return (items as ItemInput[]).map((item, index) => {
    const description = String(item.description ?? "").trim();
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);

    if (!description) throw new ApiError(`Line ${index + 1}: description is required`);
    if (!(quantity > 0)) throw new ApiError(`Line ${index + 1}: quantity must be greater than zero`);
    if (!(unitPrice >= 0)) throw new ApiError(`Line ${index + 1}: unit price cannot be negative`);

    return { description, quantity, unit_price: unitPrice, line_total: Math.round(quantity * unitPrice * 100) / 100 };
  });
}

async function saveInvoice(body: Row, id?: number) {
  const values = pickFields(body, fields);
  const items = parseItems(body.items);

  if (String(values.due_date) < String(values.issued_date)) {
    throw new ApiError("Due date cannot be before the issue date");
  }

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.line_total, 0) * 100) / 100;
  const taxRate = Number(values.tax_rate ?? 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  const totals = { ...values, tax_rate: taxRate, subtotal, tax, total: subtotal + tax, customer_id: values.customer_id ?? null };

  const savedId = await withTransaction(async (connection) => {
    let invoiceId = id;

    if (invoiceId) {
      const [result] = await connection.query<ResultSetHeader>("UPDATE invoices SET ? WHERE id = ?", [totals, invoiceId]);
      if (result.affectedRows === 0) throw new ApiError("Invoice not found", 404);
      await connection.query("DELETE FROM invoice_items WHERE invoice_id = ?", [invoiceId]);
    } else {
      const [result] = await connection.query<ResultSetHeader>("INSERT INTO invoices SET ?", [
        { ...totals, invoice_number: `TMP-${crypto.randomUUID()}` },
      ]);
      invoiceId = result.insertId;
      await connection.query("UPDATE invoices SET invoice_number = CONCAT('INV-', LPAD(id, 4, '0')) WHERE id = ?", [invoiceId]);
    }

    await connection.query(
      "INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total) VALUES ?",
      [items.map((item) => [invoiceId, item.description, item.quantity, item.unit_price, item.line_total])]
    );

    return invoiceId;
  });

  return (await getInvoice(savedId))!;
}

export const GET = handle(async (request) => {
  if (request.nextUrl.searchParams.has("id")) {
    const invoice = await getInvoice(requireId(request));
    if (!invoice) throw new ApiError("Invoice not found", 404);
    return NextResponse.json({ success: true, data: invoice });
  }

  const rows = await queryRows("SELECT * FROM invoices ORDER BY issued_date DESC, id DESC");
  return NextResponse.json({ success: true, data: rows.map(withStatus) });
});

export const POST = handle(async (request) =>
  NextResponse.json({ success: true, data: await saveInvoice(await request.json()) }, { status: 201 })
);

export const PUT = handle(async (request) => {
  const body = await request.json();
  return NextResponse.json({ success: true, data: await saveInvoice(body, requireId(request, body)) });
});

export const DELETE = handle(async (request) => {
  const id = requireId(request);
  const [{ paid } = { paid: 0 }] = await queryRows<{ paid: number }>(
    "SELECT COUNT(*) AS paid FROM payments WHERE invoice_id = ? AND status = 'Completed'",
    [id]
  );

  if (paid > 0) throw new ApiError("This invoice has completed payments. Refund or remove them before deleting.", 409);

  await db.query("DELETE FROM invoices WHERE id = ?", [id]);
  return NextResponse.json({ success: true });
});
