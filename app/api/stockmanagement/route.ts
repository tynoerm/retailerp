import { NextResponse } from "next/server";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError, handle, queryRows, type Row } from "@/app/lib/crud";
import { assignNumber, changeStock, stockStatus, tempNumber, withTransaction } from "@/app/lib/stock";
import { createCount, submitCount } from "@/app/lib/cycle-counts";
import { completeTransfer, createTransferOrder } from "@/app/lib/wms";

const positiveInt = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new ApiError(`${label} must be a whole number greater than zero`);
  return number;
};

const lockedStock = async (connection: PoolConnection, stockId: unknown) => {
  const [[row]] = await connection.query<RowDataPacket[]>(
    "SELECT id, product_id, warehouse_id, quantity, reserved FROM stock_levels WHERE id = ? FOR UPDATE",
    [Number(stockId)]
  );
  if (!row) throw new ApiError("Stock record not found", 404);
  return row;
};

export const GET = handle(async () => {
  const [stock, movements, transfers, batches] = await Promise.all([
    queryRows<Row & { quantity: number; reorderLevel: number }>(`
      SELECT s.id, s.product_id AS productId, s.warehouse_id AS warehouseId,
             p.name AS product, p.sku, p.category, w.name AS warehouse,
             s.quantity, s.reserved, p.reorder_level AS reorderLevel, p.cost, p.price,
             COALESCE((
               SELECT GROUP_CONCAT(CONCAT(l.code, ' (', t.qty, ')') ORDER BY l.pick_sequence, l.code SEPARATOR ', ')
               FROM (SELECT location_id, SUM(quantity) AS qty FROM location_stock WHERE product_id = s.product_id GROUP BY location_id) t
               JOIN warehouse_locations l ON l.id = t.location_id AND l.warehouse_id = s.warehouse_id
             ), '') AS bins
      FROM stock_levels s
      JOIN products p ON p.id = s.product_id
      JOIN warehouses w ON w.id = s.warehouse_id
      ORDER BY p.name, w.name
    `),
    queryRows(`
      SELECT m.id, m.movement_number AS number, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i') AS date, m.type,
             p.name AS product, p.sku, w.name AS warehouse, m.quantity, COALESCE(m.reference, '') AS reference,
             m.user_name AS user, COALESCE(m.notes, '') AS notes, COALESCE(l.code, '') AS location
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id
      JOIN warehouses w ON w.id = m.warehouse_id
      LEFT JOIN warehouse_locations l ON l.id = m.location_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 500
    `),
    queryRows(`
      SELECT t.id, t.transfer_number AS reference, p.name AS product, p.sku, t.quantity,
             wf.name AS \`from\`, wt.name AS \`to\`, t.status, DATE_FORMAT(t.created_at, '%d %b %Y') AS date,
             COALESCE(o.order_number, '') AS dispatchOrder, COALESCE(o.status, '') AS dispatchStatus
      FROM stock_transfers t
      JOIN products p ON p.id = t.product_id
      JOIN warehouses wf ON wf.id = t.from_warehouse_id
      JOIN warehouses wt ON wt.id = t.to_warehouse_id
      LEFT JOIN dispatch_orders o ON o.id = (SELECT MAX(id) FROM dispatch_orders WHERE transfer_id = t.id)
      ORDER BY t.id DESC
    `),
    queryRows<Row & { daysToExpiry: number | null }>(`
      SELECT b.id, p.name AS product, p.sku, w.name AS warehouse, b.batch_number AS batch,
             DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry, b.quantity,
             DATEDIFF(b.expiry_date, CURDATE()) AS daysToExpiry, b.quantity * p.cost AS value,
             COALESCE((
               SELECT GROUP_CONCAT(CONCAT(l.code, ' (', ls.quantity, ')') ORDER BY l.pick_sequence SEPARATOR ', ')
               FROM location_stock ls JOIN warehouse_locations l ON l.id = ls.location_id
               WHERE ls.product_id = b.product_id AND l.warehouse_id = b.warehouse_id AND ls.batch_number = b.batch_number
             ), '') AS bins
      FROM product_batches b
      JOIN products p ON p.id = b.product_id
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.quantity > 0
      ORDER BY b.expiry_date IS NULL, b.expiry_date, p.name
    `),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      stock: stock.map((row) => ({ ...row, status: stockStatus(row.quantity, row.reorderLevel) })),
      movements,
      transfers,
      batches: batches.map((batch) => ({
        ...batch,
        expiryStatus:
          batch.daysToExpiry === null ? "No expiry" : batch.daysToExpiry < 0 ? "Expired" : batch.daysToExpiry <= 30 ? "Expiring Soon" : "OK",
      })),
    },
  });
});

export const POST = handle(async (request) => {
  const body = await request.json();

  const message = await withTransaction(async (connection) => {
    switch (body.action) {
      case "adjust": {
        const row = await lockedStock(connection, body.stockId);
        const quantity = positiveInt(body.quantity, "Adjustment quantity");
        const delta = body.direction === "decrease" ? -quantity : quantity;
        const reason = String(body.reason ?? "").trim();

        if (!reason) throw new ApiError("Enter a reason for the adjustment");

        const batchNumber = String(body.batchNumber ?? "").trim();

        await changeStock(connection, {
          productId: row.product_id,
          warehouseId: row.warehouse_id,
          delta,
          type: "Adjustment",
          notes: reason,
          batches: delta > 0 && batchNumber
            ? [{ number: batchNumber, expiry: String(body.expiryDate ?? "") || null, quantity: delta }]
            : undefined,
        });

        return "Stock adjusted";
      }

      case "writeOffBatch": {
        const [[batch]] = await connection.query<RowDataPacket[]>(
          `SELECT id, product_id, warehouse_id, batch_number, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry, quantity
           FROM product_batches WHERE id = ? FOR UPDATE`,
          [Number(body.batchId)]
        );

        if (!batch || batch.quantity <= 0) throw new ApiError("Batch not found or already empty", 404);

        await connection.query("UPDATE product_batches SET quantity = 0 WHERE id = ?", [batch.id]);
        await changeStock(connection, {
          productId: batch.product_id,
          warehouseId: batch.warehouse_id,
          delta: -batch.quantity,
          type: "Expired",
          notes: String(body.reason ?? "").trim() || "Expired stock written off",
          skipBatches: true,
          batches: [{ number: batch.batch_number, expiry: batch.expiry, quantity: batch.quantity }],
          allowNegative: true,
        });

        return `Batch ${batch.batch_number} written off (${batch.quantity} units)`;
      }

      case "count": {
        const row = await lockedStock(connection, body.stockId);
        const counted = Number(body.counted);

        if (!Number.isInteger(counted) || counted < 0) throw new ApiError("Counted quantity must be a whole number of 0 or more");

        // Recorded as a completed cycle count so the risk-based schedule knows when this item was last counted.
        const countId = await createCount(connection, { warehouseId: row.warehouse_id, productId: row.product_id, reason: "Manual stock count" });
        const { variance } = await submitCount(connection, countId, counted);

        return variance === 0 ? "Count matches system quantity — no change needed" : "Stock count saved";
      }

      case "transfer": {
        const productId = positiveInt(body.productId, "Product");
        const fromId = positiveInt(body.fromWarehouseId, "Source warehouse");
        const toId = positiveInt(body.toWarehouseId, "Destination warehouse");
        const quantity = positiveInt(body.quantity, "Transfer quantity");

        if (fromId === toId) throw new ApiError("Source and destination warehouses must be different");

        const [[source]] = await connection.query<RowDataPacket[]>(
          "SELECT quantity, reserved FROM stock_levels WHERE product_id = ? AND warehouse_id = ?",
          [productId, fromId]
        );
        const available = source ? source.quantity - source.reserved : 0;

        if (quantity > available) throw new ApiError(`Only ${Math.max(available, 0)} units are available in the source warehouse`, 409);

        const [result] = await connection.query<ResultSetHeader>(
          "INSERT INTO stock_transfers (transfer_number, product_id, from_warehouse_id, to_warehouse_id, quantity) VALUES (?, ?, ?, ?, ?)",
          [tempNumber(), productId, fromId, toId, quantity]
        );
        await assignNumber(connection, "stock_transfers", "transfer_number", "TRF", result.insertId, 5);
        const order = await createTransferOrder(connection, result.insertId);

        return `Transfer created — pick it under Picking & Dispatch (${order.number}) or complete it directly`;
      }

      case "completeTransfer":
        return completeTransfer(connection, Number(body.transferId));

      default:
        throw new ApiError("Unknown stock action");
    }
  });

  return NextResponse.json({ success: true, data: { message } });
});
