import { NextResponse } from "next/server";
import { ApiError, handle, queryRows, requireId } from "@/app/lib/crud";
import { addLaybyPayment, cancelSale, createSale, returnSale } from "@/app/lib/sales";

const STATUSES = ["COMPLETED", "HELD", "QUOTE", "LAYBY", "CANCELLED", "CONVERTED"];

/* GET /api/pos            -> sales list (?status=LAYBY&search=...)
   GET /api/pos?id=123     -> one sale with items, payments and returns */
export const GET = handle(async (request) => {
  const params = request.nextUrl.searchParams;

  if (params.has("id")) {
    const id = requireId(request);
    const [[sale], items, payments, returns] = await Promise.all([
      queryRows(
        `SELECT s.*, w.name AS warehouse FROM sales s LEFT JOIN warehouses w ON w.id = s.warehouse_id WHERE s.id = ?`,
        [id]
      ),
      queryRows(
        `SELECT id, product_id AS productId, product_name AS name, sku, quantity, returned_quantity AS returnedQuantity,
                unit_price AS unitPrice, line_total AS lineTotal, unit_name AS unitName, unit_multiplier AS multiplier
         FROM sale_items WHERE sale_id = ? ORDER BY id`,
        [id]
      ),
      queryRows(
        `SELECT method, currency, exchange_rate AS rate, amount_tendered AS tendered, amount, reference, created_at AS createdAt
         FROM sale_payments WHERE sale_id = ? ORDER BY id`,
        [id]
      ),
      queryRows(
        `SELECT return_number AS number, reason, refund_method AS method, refund_amount AS amount, created_at AS createdAt
         FROM sale_returns WHERE sale_id = ? ORDER BY id`,
        [id]
      ),
    ]);

    if (!sale) throw new ApiError("Sale not found", 404);
    return NextResponse.json({ success: true, data: { ...sale, items, payments, returns } });
  }

  const status = params.get("status");
  const search = `%${(params.get("search") ?? "").trim()}%`;

  if (status && !STATUSES.includes(status)) throw new ApiError("Unknown status filter");

  const rows = await queryRows(
    `SELECT s.id, s.sale_number AS number, s.customer, s.customer_id AS customerId, s.status, s.total, s.amount_paid AS paid,
            s.refunded_total AS refunded, s.currency, s.exchange_rate AS rate, s.payment_method AS payment,
            s.price_tier AS priceTier, s.warehouse_id AS warehouseId, w.name AS warehouse, s.created_at AS createdAt,
            CAST(COALESCE((SELECT SUM(quantity) FROM sale_items i WHERE i.sale_id = s.id), 0) AS SIGNED) AS items
     FROM sales s
     LEFT JOIN warehouses w ON w.id = s.warehouse_id
     WHERE (? IS NULL OR s.status = ?) AND (s.sale_number LIKE ? OR s.customer LIKE ?)
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 300`,
    [status, status, search, search]
  );

  return NextResponse.json({ success: true, data: rows });
});

/* POST /api/pos -> create a sale (COMPLETED, HELD, QUOTE or LAYBY) */
export const POST = handle(async (request) => {
  const sale = await createSale(await request.json());
  const messages = {
    COMPLETED: "Sale completed successfully",
    HELD: "Sale placed on hold",
    QUOTE: "Quotation saved",
    LAYBY: "Lay-by created and stock reserved",
  };
  return NextResponse.json({ success: true, message: messages[sale.status], sale }, { status: 201 });
});

/* PUT /api/pos { id, action: "payment" | "return" | "cancel", ... } */
export const PUT = handle(async (request) => {
  const body = await request.json();
  const id = requireId(request, body);

  switch (body.action) {
    case "payment":
      return NextResponse.json({ success: true, data: await addLaybyPayment(id, body.payments) });
    case "return":
      return NextResponse.json({ success: true, data: await returnSale(id, body) });
    case "cancel":
      return NextResponse.json({ success: true, data: await cancelSale(id, body.refundMethod) });
    default:
      throw new ApiError("Unknown sale action");
  }
});
