import { NextResponse } from "next/server";
import { ApiError, handle, queryRows } from "@/app/lib/crud";
import { withTransaction } from "@/app/lib/stock";
import { receivePurchaseOrder, receiveTransfer } from "@/app/lib/wms";

/** Inbound work: transfers in transit (purchase orders are listed by /api/procurement). */
export const GET = handle(async () => {
  const transfers = await queryRows(`
    SELECT t.id, t.transfer_number AS reference, p.name AS product, p.sku, t.quantity,
           COALESCE((SELECT SUM(i.dispatched_quantity) FROM dispatch_orders o JOIN dispatch_order_items i ON i.order_id = o.id
                     WHERE o.transfer_id = t.id AND o.status = 'Dispatched'), t.quantity) AS dispatched,
           wf.name AS \`from\`, wt.name AS \`to\`, t.to_warehouse_id AS warehouseId, DATE_FORMAT(t.created_at, '%d %b %Y') AS date
    FROM stock_transfers t
    JOIN products p ON p.id = t.product_id
    JOIN warehouses wf ON wf.id = t.from_warehouse_id
    JOIN warehouses wt ON wt.id = t.to_warehouse_id
    WHERE t.status = 'In Transit'
    ORDER BY t.id
  `);

  return NextResponse.json({ success: true, data: { transfers } });
});

/** Receive goods: `{ type: "po", orderId, lines, notes, crossDock }` or `{ type: "transfer", transferId, crossDock }`. */
export const POST = handle(async (request) => {
  const body = await request.json();

  const message = await withTransaction(async (connection) => {
    if (body.type === "transfer") return receiveTransfer(connection, Number(body.transferId), { crossDock: body.crossDock !== false });
    if (body.type === "po") return receivePurchaseOrder(connection, Number(body.orderId), body);
    throw new ApiError("Unknown receipt type");
  });

  return NextResponse.json({ success: true, data: { message } });
});
