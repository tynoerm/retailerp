import { NextResponse } from "next/server";
import { ApiError, handle, queryRows } from "@/app/lib/crud";
import { withTransaction } from "@/app/lib/stock";
import { confirmPick, confirmPutaway, dispatchOrder, moveBetweenBins, packOrder } from "@/app/lib/wms";

const TASK_COLUMNS = `
  t.id, t.task_number AS number, t.type, t.product_id AS productId, p.name AS product, p.sku,
  COALESCE(p.barcode, '') AS barcode,
  COALESCE((SELECT GROUP_CONCAT(u.barcode) FROM product_units u WHERE u.product_id = p.id AND u.barcode IS NOT NULL), '') AS unitBarcodes,
  p.track_serials AS trackSerials, t.batch_number AS batch,
  DATE_FORMAT(pb.expiry_date, '%Y-%m-%d') AS expiry,
  t.from_location_id AS fromId, COALESCE(lf.code, '') AS fromCode, COALESCE(lf.barcode, '') AS fromBarcode,
  t.to_location_id AS toId, COALESCE(lt.code, '') AS toCode, COALESCE(lt.barcode, '') AS toBarcode,
  t.quantity - t.done_quantity AS quantity, t.sequence, COALESCE(t.reference, '') AS reference,
  DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i') AS createdAt`;

const TASK_JOINS = `
  JOIN products p ON p.id = t.product_id
  LEFT JOIN warehouse_locations lf ON lf.id = t.from_location_id
  LEFT JOIN warehouse_locations lt ON lt.id = t.to_location_id
  LEFT JOIN product_batches pb ON pb.product_id = t.product_id AND pb.warehouse_id = t.warehouse_id AND pb.batch_number = t.batch_number`;

/** What a scanned code refers to: location, product, dispatch order, wave or serial number. */
async function lookup(code: string, warehouseId: number | null) {
  const [locations, products, orders, serials] = await Promise.all([
    queryRows(
      `SELECT id, code, type, warehouse_id AS warehouseId FROM warehouse_locations
       WHERE (UPPER(barcode) = UPPER(?) OR UPPER(code) = UPPER(?)) AND (? IS NULL OR warehouse_id = ?) LIMIT 5`,
      [code, code, warehouseId, warehouseId]
    ),
    queryRows(
      `SELECT DISTINCT p.id, p.name, p.sku FROM products p LEFT JOIN product_units u ON u.product_id = p.id
       WHERE UPPER(p.sku) = UPPER(?) OR p.barcode = ? OR u.barcode = ? LIMIT 5`,
      [code, code, code]
    ),
    queryRows("SELECT id, order_number AS number, status FROM dispatch_orders WHERE UPPER(order_number) = UPPER(?) LIMIT 1", [code]),
    queryRows(
      `SELECT s.serial_number AS serial, p.name AS product, s.status, COALESCE(l.code, '') AS location
       FROM product_serials s JOIN products p ON p.id = s.product_id LEFT JOIN warehouse_locations l ON l.id = s.location_id
       WHERE s.serial_number = ? LIMIT 5`,
      [code]
    ),
  ]);
  return { locations, products, orders, serials };
}

export const GET = handle(async (request) => {
  const params = request.nextUrl.searchParams;
  const warehouseId = Number(params.get("warehouseId")) || null;
  const scan = params.get("scan");

  if (scan) return NextResponse.json({ success: true, data: await lookup(scan.trim(), warehouseId) });

  const [putaway, picks, outbound, moves] = await Promise.all([
    queryRows(
      `SELECT ${TASK_COLUMNS} FROM warehouse_tasks t ${TASK_JOINS}
       WHERE t.type = 'Put-away' AND t.status = 'Open' AND (? IS NULL OR t.warehouse_id = ?)
       ORDER BY lt.pick_sequence IS NULL, lt.pick_sequence, t.id`,
      [warehouseId, warehouseId]
    ),
    queryRows(
      `SELECT ${TASK_COLUMNS}, t.order_id AS orderId, COALESCE(o.order_number, '') AS orderNumber, COALESCE(o.priority, 'Normal') AS priority,
              t.wave_id AS waveId, COALESCE(w.wave_number, '') AS wave
       FROM warehouse_tasks t ${TASK_JOINS}
       LEFT JOIN dispatch_orders o ON o.id = t.order_id
       LEFT JOIN pick_waves w ON w.id = t.wave_id
       WHERE t.type = 'Pick' AND t.status = 'Open' AND (? IS NULL OR t.warehouse_id = ?)
       ORDER BY t.sequence, lf.code, t.id`,
      [warehouseId, warehouseId]
    ),
    queryRows(
      `SELECT o.id, o.order_number AS number, o.type, o.customer_name AS customer, COALESCE(o.ship_to, '') AS shipTo, o.priority, o.status,
              o.packages, CAST(SUM(i.quantity) AS SIGNED) AS quantity, CAST(SUM(i.picked_quantity) AS SIGNED) AS picked
       FROM dispatch_orders o JOIN dispatch_order_items i ON i.order_id = o.id
       WHERE o.status IN ('Picked', 'Part Picked', 'Packed') AND (? IS NULL OR o.warehouse_id = ?)
       GROUP BY o.id ORDER BY FIELD(o.priority, 'Urgent', 'High', 'Normal'), o.id`,
      [warehouseId, warehouseId]
    ),
    queryRows(
      `SELECT m.id, m.type, p.name AS product, m.batch_number AS batch, COALESCE(lf.code, '') AS \`from\`, COALESCE(lt.code, '') AS \`to\`,
              m.quantity, COALESCE(m.reference, '') AS reference, m.user_name AS user, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i') AS date
       FROM location_moves m JOIN products p ON p.id = m.product_id
       LEFT JOIN warehouse_locations lf ON lf.id = m.from_location_id
       LEFT JOIN warehouse_locations lt ON lt.id = m.to_location_id
       WHERE ? IS NULL OR m.warehouse_id = ?
       ORDER BY m.id DESC LIMIT 100`,
      [warehouseId, warehouseId]
    ),
  ]);

  return NextResponse.json({ success: true, data: { putaway, picks, outbound, moves } });
});

/** Floor actions: confirmPick | confirmPutaway | move | pack | dispatch. */
export const POST = handle(async (request) => {
  const body = await request.json();

  const message = await withTransaction(async (connection) => {
    switch (body.action) {
      case "confirmPick":
        return confirmPick(connection, body);
      case "confirmPutaway":
        return confirmPutaway(connection, body);
      case "move":
        return moveBetweenBins(connection, body);
      case "pack":
        return packOrder(connection, body.order, body.packages);
      case "dispatch":
        return dispatchOrder(connection, body);
      default:
        throw new ApiError("Unknown warehouse action");
    }
  });

  return NextResponse.json({ success: true, data: { message } });
});
