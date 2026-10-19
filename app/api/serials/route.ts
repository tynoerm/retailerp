import { NextResponse } from "next/server";
import { handle, queryRows } from "@/app/lib/crud";

/** Serial number lookup / traceability. `?q=` matches serial, product name or SKU. */
export const GET = handle(async (request) => {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const status = params.get("status") || null;
  const like = `%${q}%`;

  const rows = await queryRows(
    `SELECT s.id, s.serial_number AS serial, p.name AS product, p.sku, s.status, COALESCE(w.name, '') AS warehouse,
            COALESCE(l.code, '') AS location, COALESCE(s.batch_number, '') AS batch, COALESCE(s.reference, '') AS reference,
            COALESCE(o.order_number, '') AS dispatchOrder, DATE_FORMAT(s.received_at, '%Y-%m-%d') AS receivedAt,
            DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i') AS updatedAt
     FROM product_serials s
     JOIN products p ON p.id = s.product_id
     LEFT JOIN warehouses w ON w.id = s.warehouse_id
     LEFT JOIN warehouse_locations l ON l.id = s.location_id
     LEFT JOIN dispatch_orders o ON o.id = s.dispatch_order_id
     WHERE (? = '' OR s.serial_number LIKE ? OR p.name LIKE ? OR p.sku LIKE ?) AND (? IS NULL OR s.status = ?)
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT 300`,
    [q, like, like, like, status, status]
  );

  return NextResponse.json({ success: true, data: rows });
});
