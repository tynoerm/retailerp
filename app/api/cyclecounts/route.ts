import { NextResponse } from "next/server";
import { ApiError, handle, queryRows } from "@/app/lib/crud";
import { withTransaction } from "@/app/lib/stock";
import { computeSchedule, createCount, generateCounts, submitCount } from "@/app/lib/cycle-counts";

export const GET = handle(async (request) => {
  const warehouseId = Number(request.nextUrl.searchParams.get("warehouseId")) || null;

  const [schedule, open, recent] = await Promise.all([
    computeSchedule(warehouseId),
    // Blind counts: the system quantity of open counts is deliberately not returned.
    queryRows(
      `SELECT c.id, c.count_number AS number, c.product_id AS productId, p.name AS product, p.sku, COALESCE(p.barcode, '') AS barcode,
              w.name AS warehouse, c.warehouse_id AS warehouseId, COALESCE(l.code, 'Whole warehouse') AS location,
              COALESCE(l.barcode, '') AS locationBarcode, c.risk_class AS riskClass, c.risk_score AS riskScore,
              COALESCE(c.reason, '') AS reason, DATE_FORMAT(c.due_date, '%Y-%m-%d') AS dueDate, c.due_date < CURDATE() AS overdue
       FROM cycle_counts c JOIN products p ON p.id = c.product_id JOIN warehouses w ON w.id = c.warehouse_id
       LEFT JOIN warehouse_locations l ON l.id = c.location_id
       WHERE c.status = 'Open' AND (? IS NULL OR c.warehouse_id = ?)
       ORDER BY c.due_date, COALESCE(c.risk_score, 0) DESC, l.pick_sequence, c.id`,
      [warehouseId, warehouseId]
    ),
    queryRows(
      `SELECT c.id, c.count_number AS number, p.name AS product, p.sku, w.name AS warehouse, COALESCE(l.code, 'Whole warehouse') AS location,
              c.status, c.system_quantity AS systemQuantity, c.counted_quantity AS counted, c.variance,
              COALESCE(c.counted_by, '') AS countedBy, DATE_FORMAT(c.counted_at, '%Y-%m-%d %H:%i') AS countedAt
       FROM cycle_counts c JOIN products p ON p.id = c.product_id JOIN warehouses w ON w.id = c.warehouse_id
       LEFT JOIN warehouse_locations l ON l.id = c.location_id
       WHERE c.status <> 'Open' AND (? IS NULL OR c.warehouse_id = ?)
       ORDER BY c.counted_at DESC, c.id DESC LIMIT 100`,
      [warehouseId, warehouseId]
    ),
  ]);

  return NextResponse.json({ success: true, data: { schedule, open, recent } });
});

/** generate { warehouseId?, includeNotDue? } | create { productId, warehouseId, locationId? } | submit { countId, counted } | cancel { countId } */
export const POST = handle(async (request) => {
  const body = await request.json();

  const message = await withTransaction(async (connection) => {
    switch (body.action) {
      case "generate": {
        const created = await generateCounts(connection, { warehouseId: Number(body.warehouseId) || null, includeNotDue: Boolean(body.includeNotDue) });
        return created ? `${created} count task${created === 1 ? "" : "s"} created` : "No items are due for counting";
      }
      case "create": {
        const productId = Number(body.productId);
        const warehouseId = Number(body.warehouseId);
        if (!productId || !warehouseId) throw new ApiError("Select a product and warehouse");
        await createCount(connection, { productId, warehouseId, locationId: Number(body.locationId) || null, reason: "Ad-hoc count" });
        return "Count task created";
      }
      case "submit": {
        const { number, variance } = await submitCount(connection, Number(body.countId), body.counted);
        return variance === 0 ? `${number}: count matches` : `${number}: variance ${variance > 0 ? "+" : ""}${variance} posted`;
      }
      case "cancel": {
        await connection.query("UPDATE cycle_counts SET status = 'Cancelled' WHERE id = ? AND status = 'Open'", [Number(body.countId)]);
        return "Count cancelled";
      }
      default:
        throw new ApiError("Unknown cycle count action");
    }
  });

  return NextResponse.json({ success: true, data: { message } });
});
