import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import db from "@/app/lib/db";
import { ApiError, handle, queryRows, requireId, type Row } from "@/app/lib/crud";
import { LOCATION_TYPES } from "@/app/lib/locations";

const text = (value: unknown, max: number) => String(value ?? "").trim().toUpperCase().slice(0, max) || null;

function readLocation(body: Row) {
  const type = String(body.type || "Storage");
  if (!LOCATION_TYPES.includes(type as (typeof LOCATION_TYPES)[number])) throw new ApiError(`Type must be one of: ${LOCATION_TYPES.join(", ")}`);

  const capacity = body.capacity === "" || body.capacity == null ? null : Number(body.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) throw new ApiError("Capacity must be a whole number above zero (or blank for unlimited)");

  const sequence = body.pickSequence === "" || body.pickSequence == null ? 0 : Number(body.pickSequence);
  if (!Number.isInteger(sequence) || sequence < 0) throw new ApiError("Pick sequence must be a whole number of 0 or more");

  const zone = text(body.zone, 30);
  const aisle = text(body.aisle, 20);
  const shelf = text(body.shelf, 20);
  const bin = text(body.bin, 20);
  const code = text(body.code, 40) ?? [aisle, shelf, bin].filter(Boolean).join("-");
  if (!code) throw new ApiError("Enter a location code, or the aisle / shelf / bin");
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) throw new ApiError("Location codes may only contain letters, numbers, dot, dash and underscore");

  return {
    code, zone, aisle, shelf, bin, type, capacity, pick_sequence: sequence,
    status: body.status === "Inactive" ? "Inactive" : "Active",
    barcode: text(body.barcode, 60),
  };
}

async function warehouseCode(id: number) {
  const [row] = await queryRows<{ code: string }>("SELECT code FROM warehouses WHERE id = ?", [id]);
  if (!row) throw new ApiError("Warehouse not found", 404);
  return row.code.toUpperCase();
}

export const GET = handle(async (request) => {
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const contents = await queryRows(
      `SELECT ls.product_id AS productId, p.name AS product, p.sku, ls.batch_number AS batch,
              DATE_FORMAT(pb.expiry_date, '%Y-%m-%d') AS expiry, ls.quantity,
              (SELECT COUNT(*) FROM product_serials ps WHERE ps.product_id = ls.product_id AND ps.location_id = ls.location_id AND ps.status IN ('In Stock', 'Picked')) AS serials
       FROM location_stock ls
       JOIN warehouse_locations l ON l.id = ls.location_id
       JOIN products p ON p.id = ls.product_id
       LEFT JOIN product_batches pb ON pb.product_id = ls.product_id AND pb.warehouse_id = l.warehouse_id AND pb.batch_number = ls.batch_number
       WHERE ls.location_id = ? AND ls.quantity > 0
       ORDER BY p.name, pb.expiry_date`,
      [requireId(request)]
    );
    return NextResponse.json({ success: true, data: { contents } });
  }

  const warehouseId = Number(request.nextUrl.searchParams.get("warehouseId")) || null;
  const rows = await queryRows(
    `SELECT l.id, l.warehouse_id AS warehouseId, w.name AS warehouse, l.code, COALESCE(l.zone, '') AS zone,
            COALESCE(l.aisle, '') AS aisle, COALESCE(l.shelf, '') AS shelf, COALESCE(l.bin, '') AS bin, l.type, l.barcode,
            l.pick_sequence AS pickSequence, l.capacity, l.status, l.is_system AS isSystem,
            CAST(COALESCE(SUM(ls.quantity), 0) AS SIGNED) AS units, COUNT(DISTINCT ls.product_id) AS products,
            (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.status = 'Open' AND (t.from_location_id = l.id OR t.to_location_id = l.id)) AS openTasks
     FROM warehouse_locations l
     JOIN warehouses w ON w.id = l.warehouse_id
     LEFT JOIN location_stock ls ON ls.location_id = l.id AND ls.quantity > 0
     WHERE (? IS NULL OR l.warehouse_id = ?)
     GROUP BY l.id
     ORDER BY l.warehouse_id, l.is_system DESC, l.pick_sequence, l.code`,
    [warehouseId, warehouseId]
  );

  return NextResponse.json({ success: true, data: rows });
});

export const POST = handle(async (request) => {
  const body = await request.json();
  const warehouseId = Number(body.warehouseId);
  const prefix = await warehouseCode(warehouseId);

  if (body.action === "generate") {
    const aisles = String(body.aisles ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean).flatMap((part) => {
      const range = /^([A-Z])-([A-Z])$/.exec(part);
      if (!range) return [part];
      const [from, to] = [range[1].charCodeAt(0), range[2].charCodeAt(0)];
      return Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => String.fromCharCode(from + i));
    });
    const shelves = Number(body.shelves);
    const bins = Number(body.bins);

    if (aisles.length === 0) throw new ApiError("Enter the aisles, e.g. A-D or A,B,C");
    if (!Number.isInteger(shelves) || shelves < 1 || shelves > 50) throw new ApiError("Shelves per aisle must be between 1 and 50");
    if (!Number.isInteger(bins) || bins < 1 || bins > 50) throw new ApiError("Bins per shelf must be between 1 and 50");
    if (aisles.length * shelves * bins > 5000) throw new ApiError("That would create more than 5,000 locations — generate in smaller batches");

    const template = readLocation({ ...body, code: "X" });
    const pad = (n: number) => String(n).padStart(2, "0");
    const perAisle = shelves * bins;
    const rows = aisles.flatMap((aisle, aisleIndex) =>
      Array.from({ length: perAisle }, (_, i) => {
        const shelf = Math.floor(i / bins) + 1;
        const bin = (i % bins) + 1;
        const code = `${aisle}-${pad(shelf)}-${pad(bin)}`;
        // Serpentine walking route: odd aisles walked forwards, even aisles backwards.
        const position = aisleIndex % 2 === 0 ? i : perAisle - 1 - i;
        return [
          warehouseId, code, template.zone, aisle, pad(shelf), pad(bin), template.type, `${prefix}-${code}`,
          (aisleIndex + 1) * 1000 + position, template.capacity, "Active",
        ];
      })
    );

    const [result] = await db.query<ResultSetHeader>(
      `INSERT IGNORE INTO warehouse_locations (warehouse_id, code, zone, aisle, shelf, bin, type, barcode, pick_sequence, capacity, status)
       VALUES ?`,
      [rows]
    );
    return NextResponse.json({ success: true, data: { created: result.affectedRows, skipped: rows.length - result.affectedRows } }, { status: 201 });
  }

  const values = readLocation(body);
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO warehouse_locations SET ?",
    [{ ...values, warehouse_id: warehouseId, barcode: values.barcode ?? `${prefix}-${values.code}` }]
  );
  return NextResponse.json({ success: true, data: { id: result.insertId } }, { status: 201 });
});

export const PUT = handle(async (request) => {
  const body = await request.json();
  const id = requireId(request, body);
  const [current] = await queryRows<RowDataPacket>("SELECT * FROM warehouse_locations WHERE id = ?", [id]);
  if (!current) throw new ApiError("Location not found", 404);

  if (current.is_system) {
    const capacity = body.capacity === "" || body.capacity == null ? null : Number(body.capacity);
    await db.query("UPDATE warehouse_locations SET capacity = ? WHERE id = ?", [capacity, id]);
    return NextResponse.json({ success: true });
  }

  const values = readLocation(body);
  if (values.status === "Inactive") {
    const [{ units }] = await queryRows<{ units: number }>("SELECT COALESCE(SUM(quantity), 0) AS units FROM location_stock WHERE location_id = ?", [id]);
    if (Number(units) > 0) throw new ApiError(`${current.code} still holds ${units} units — move the stock before deactivating it`, 409);
  }

  const prefix = await warehouseCode(current.warehouse_id);
  await db.query("UPDATE warehouse_locations SET ? WHERE id = ?", [{ ...values, barcode: values.barcode ?? `${prefix}-${values.code}` }, id]);
  return NextResponse.json({ success: true });
});

export const DELETE = handle(async (request) => {
  const id = requireId(request);
  const [location] = await queryRows<RowDataPacket>(
    `SELECT l.code, l.is_system,
            (SELECT COALESCE(SUM(quantity), 0) FROM location_stock WHERE location_id = l.id) AS units,
            (SELECT COUNT(*) FROM warehouse_tasks WHERE status = 'Open' AND (from_location_id = l.id OR to_location_id = l.id)) AS tasks
     FROM warehouse_locations l WHERE l.id = ?`,
    [id]
  );

  if (!location) throw new ApiError("Location not found", 404);
  if (location.is_system) throw new ApiError("System locations (RECEIVING, DISPATCH) cannot be deleted", 409);
  if (Number(location.units) > 0) throw new ApiError(`${location.code} still holds ${location.units} units`, 409);
  if (Number(location.tasks) > 0) throw new ApiError(`${location.code} has open warehouse tasks`, 409);

  await db.query("DELETE FROM warehouse_locations WHERE id = ?", [id]);
  return NextResponse.json({ success: true });
});
