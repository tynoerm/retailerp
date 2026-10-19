import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ApiError, handle, queryRows, requireId } from "@/app/lib/crud";
import { getSettings } from "@/app/lib/settings";
import { currentUserName } from "@/app/lib/auth";
import { assignNumber, tempNumber, withTransaction } from "@/app/lib/stock";
import { receivePurchaseOrder } from "@/app/lib/wms";

type ItemInput = { productId?: unknown; quantity?: unknown; unitCost?: unknown };

export const GET = handle(async (request) => {
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const items = await queryRows(
      `SELECT i.id, i.product_id AS productId, p.name AS product, p.sku, COALESCE(p.barcode, '') AS barcode,
              (SELECT GROUP_CONCAT(u.barcode) FROM product_units u WHERE u.product_id = p.id AND u.barcode IS NOT NULL) AS unitBarcodes,
              p.track_batches AS trackBatches, p.track_serials AS trackSerials, i.quantity,
              i.received_quantity AS receivedQuantity, i.unit_cost AS unitCost
       FROM purchase_order_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.purchase_order_id = ?
       ORDER BY i.id`,
      [requireId(request)]
    );
    return NextResponse.json({ success: true, data: { items } });
  }

  const orders = await queryRows(`
    SELECT po.id, po.po_number AS number, po.supplier_id AS supplierId, s.name AS supplier, s.code AS supplierCode,
           DATE_FORMAT(po.order_date, '%Y-%m-%d') AS date, DATE_FORMAT(po.expected_date, '%Y-%m-%d') AS expectedDate,
           COUNT(i.id) AS items,
           CAST(COALESCE(SUM(i.quantity), 0) AS SIGNED) AS quantity,
           CAST(COALESCE(SUM(i.received_quantity), 0) AS SIGNED) AS received,
           po.subtotal, po.tax_rate AS taxRate, po.tax, po.total, po.status,
           w.name AS warehouse, po.requested_by AS requestedBy, COALESCE(po.notes, '') AS notes
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    JOIN warehouses w ON w.id = po.warehouse_id
    LEFT JOIN purchase_order_items i ON i.purchase_order_id = po.id
    GROUP BY po.id
    ORDER BY po.order_date DESC, po.id DESC
  `);

  return NextResponse.json({ success: true, data: orders });
});

export const POST = handle(async (request) => {
  const body = await request.json();
  const supplierId = Number(body.supplierId);
  const warehouseId = Number(body.warehouseId);
  const expectedDate = String(body.expectedDate ?? "");
  const items = Array.isArray(body.items) ? (body.items as ItemInput[]) : [];

  if (!supplierId) throw new ApiError("Select a supplier");
  if (!warehouseId) throw new ApiError("Select the receiving warehouse");
  if (Number.isNaN(Date.parse(expectedDate))) throw new ApiError("Enter the expected delivery date");
  if (items.length === 0) throw new ApiError("Add at least one product to the order");

  const lines = items.map((item, index) => {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unitCost);

    if (!productId) throw new ApiError(`Line ${index + 1}: select a product`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(`Line ${index + 1}: quantity must be a whole number above zero`);
    if (!(unitCost >= 0)) throw new ApiError(`Line ${index + 1}: unit cost cannot be negative`);

    return [productId, quantity, unitCost];
  });

  const taxRate = Number((await getSettings()).taxRate) || 0;
  const subtotal = Math.round(lines.reduce((sum, [, quantity, unitCost]) => sum + quantity * unitCost, 0) * 100) / 100;
  const tax = Math.round(subtotal * taxRate) / 100;

  const number = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, order_date, expected_date, status, subtotal, tax_rate, tax, total, notes, requested_by)
       VALUES (?, ?, ?, CURDATE(), ?, 'Pending Approval', ?, ?, ?, ?, ?, ?)`,
      [tempNumber(), supplierId, warehouseId, expectedDate, subtotal, taxRate, tax, subtotal + tax, String(body.notes ?? "").trim() || null, currentUserName()]
    );

    await connection.query(
      "INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost) VALUES ?",
      [lines.map((line) => [result.insertId, ...line])]
    );
    await assignNumber(connection, "purchase_orders", "po_number", "PO", result.insertId);

    const [[row]] = await connection.query<RowDataPacket[]>("SELECT po_number FROM purchase_orders WHERE id = ?", [result.insertId]);
    return row.po_number as string;
  });

  return NextResponse.json({ success: true, data: { number } }, { status: 201 });
});

export const PUT = handle(async (request) => {
  const body = await request.json();
  const id = requireId(request, body);

  const message = await withTransaction(async (connection) => {
    const [[order]] = await connection.query<RowDataPacket[]>("SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE", [id]);
    if (!order) throw new ApiError("Purchase order not found", 404);

    if (body.action === "approve") {
      if (!["Draft", "Pending Approval"].includes(order.status)) throw new ApiError(`A ${order.status} order cannot be approved`, 409);
      await connection.query("UPDATE purchase_orders SET status = 'Ordered' WHERE id = ?", [id]);
      return `${order.po_number} approved`;
    }

    if (body.action === "cancel") {
      if (["Received", "Cancelled"].includes(order.status)) throw new ApiError(`A ${order.status} order cannot be cancelled`, 409);
      await connection.query("UPDATE purchase_orders SET status = 'Cancelled' WHERE id = ?", [id]);
      return `${order.po_number} cancelled`;
    }

    if (body.action === "receive") return receivePurchaseOrder(connection, id, body);

    throw new ApiError("Unknown purchase order action");
  });

  return NextResponse.json({ success: true, data: { message } });
});
