import { NextResponse } from "next/server";
import { ApiError, handle, queryRows, requireId } from "@/app/lib/crud";
import { withTransaction } from "@/app/lib/stock";
import { allocateOrder, cancelOrder, createDispatchOrder, createWave, releaseOrders, releaseWave } from "@/app/lib/wms";

export const GET = handle(async (request) => {
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const orderId = requireId(request);
    const [items, tasks, serials] = await Promise.all([
      queryRows(
        `SELECT i.id, i.product_id AS productId, p.name AS product, p.sku, i.quantity, i.allocated_quantity AS allocated,
                i.picked_quantity AS picked, i.dispatched_quantity AS dispatched
         FROM dispatch_order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`,
        [orderId]
      ),
      queryRows(
        `SELECT t.id, t.task_number AS number, t.type, t.status, p.name AS product, t.batch_number AS batch,
                COALESCE(lf.code, '') AS \`from\`, COALESCE(lt.code, '') AS \`to\`, t.quantity, t.done_quantity AS done,
                COALESCE(t.completed_by, '') AS completedBy, DATE_FORMAT(t.completed_at, '%Y-%m-%d %H:%i') AS completedAt
         FROM warehouse_tasks t JOIN products p ON p.id = t.product_id
         LEFT JOIN warehouse_locations lf ON lf.id = t.from_location_id
         LEFT JOIN warehouse_locations lt ON lt.id = t.to_location_id
         WHERE t.order_id = ? ORDER BY t.sequence, t.id`,
        [orderId]
      ),
      queryRows(
        `SELECT s.serial_number AS serial, p.name AS product, s.status FROM product_serials s JOIN products p ON p.id = s.product_id
         WHERE s.dispatch_order_id = ? ORDER BY p.name, s.serial_number`,
        [orderId]
      ),
    ]);
    return NextResponse.json({ success: true, data: { items, tasks, serials } });
  }

  const [orders, waves] = await Promise.all([
    queryRows(`
      SELECT o.id, o.order_number AS number, o.type, o.warehouse_id AS warehouseId, w.name AS warehouse, o.customer_name AS customer,
             COALESCE(o.ship_to, '') AS shipTo, o.priority, DATE_FORMAT(o.required_date, '%Y-%m-%d') AS requiredDate, o.status,
             o.wave_id AS waveId, COALESCE(pw.wave_number, '') AS wave, COALESCE(o.carrier, '') AS carrier,
             COALESCE(o.tracking_number, '') AS trackingNumber, o.packages, COALESCE(o.notes, '') AS notes,
             COUNT(i.id) AS lines, CAST(SUM(i.quantity) AS SIGNED) AS quantity, CAST(SUM(i.allocated_quantity) AS SIGNED) AS allocated,
             CAST(SUM(i.picked_quantity) AS SIGNED) AS picked, CAST(SUM(i.dispatched_quantity) AS SIGNED) AS dispatched,
             (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.order_id = o.id AND t.type = 'Pick' AND t.status = 'Open') AS openPicks,
             (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.order_id = o.id AND t.type = 'Cross-dock') AS crossDocks,
             DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i') AS createdAt, DATE_FORMAT(o.dispatched_at, '%Y-%m-%d %H:%i') AS dispatchedAt
      FROM dispatch_orders o
      JOIN warehouses w ON w.id = o.warehouse_id
      JOIN dispatch_order_items i ON i.order_id = o.id
      LEFT JOIN pick_waves pw ON pw.id = o.wave_id
      GROUP BY o.id
      ORDER BY o.status IN ('Dispatched', 'Cancelled'), FIELD(o.priority, 'Urgent', 'High', 'Normal'), o.required_date IS NULL, o.required_date, o.id DESC
      LIMIT 500
    `),
    queryRows(`
      SELECT pw.id, pw.wave_number AS number, pw.warehouse_id AS warehouseId, w.name AS warehouse, pw.status, pw.created_by AS createdBy,
             DATE_FORMAT(pw.created_at, '%Y-%m-%d %H:%i') AS createdAt,
             (SELECT COUNT(*) FROM dispatch_orders o WHERE o.wave_id = pw.id) AS orders,
             (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.wave_id = pw.id AND t.type = 'Pick') AS tasks,
             (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.wave_id = pw.id AND t.type = 'Pick' AND t.status = 'Open') AS openTasks
      FROM pick_waves pw JOIN warehouses w ON w.id = pw.warehouse_id
      ORDER BY pw.status = 'Completed', pw.id DESC
      LIMIT 200
    `),
  ]);

  return NextResponse.json({ success: true, data: { orders, waves } });
});

export const POST = handle(async (request) => {
  const body = await request.json();
  const order = await withTransaction((connection) => createDispatchOrder(connection, { ...body, type: "Customer" }));
  return NextResponse.json({ success: true, data: { ...order, message: `${order.number} created (${order.status})` } }, { status: 201 });
});

/** Order and wave actions: allocate | release | cancel | createWave { orderIds } | releaseWave { waveId }. */
export const PUT = handle(async (request) => {
  const body = await request.json();

  const message = await withTransaction(async (connection) => {
    switch (body.action) {
      case "allocate": {
        const allocated = await allocateOrder(connection, requireId(request, body));
        return allocated ? `Allocated ${allocated} more units` : "No additional stock is available to allocate";
      }
      case "release": {
        const { tasks, shortfall } = await releaseOrders(connection, [requireId(request, body)]);
        if (tasks === 0 && shortfall === 0) throw new ApiError("Nothing to release — allocate stock first", 409);
        return `${tasks} pick task${tasks === 1 ? "" : "s"} created${shortfall ? ` • ${shortfall} units could not be located in any bin` : ""}`;
      }
      case "cancel":
        return cancelOrder(connection, requireId(request, body));
      case "createWave": {
        const wave = await createWave(connection, body.orderIds);
        if (body.release) {
          const { tasks } = await releaseWave(connection, wave.id);
          return `${wave.number} created and released with ${tasks} pick tasks`;
        }
        return `${wave.number} created`;
      }
      case "releaseWave": {
        const { number, tasks, shortfall } = await releaseWave(connection, Number(body.waveId));
        return `${number} released: ${tasks} pick tasks${shortfall ? ` • ${shortfall} units could not be located` : ""}`;
      }
      default:
        throw new ApiError("Unknown dispatch action");
    }
  });

  return NextResponse.json({ success: true, data: { message } });
});
