import { NextResponse } from "next/server";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import db from "@/app/lib/db";
import { ApiError, handle, pickFields, queryRows, requireId, type FieldSpec, type Row } from "@/app/lib/crud";
import { changeStock, withTransaction } from "@/app/lib/stock";

const colors = [
  "bg-amber-100", "bg-yellow-100", "bg-blue-100", "bg-sky-100", "bg-orange-100", "bg-red-100",
  "bg-cyan-100", "bg-purple-100", "bg-pink-100", "bg-violet-100", "bg-emerald-100", "bg-stone-100",
];

const fields: Record<string, FieldSpec> = {
  name: { type: "string", required: true },
  sku: { type: "string", required: true },
  barcode: { type: "string" },
  category: { type: "string", required: true },
  brand: { type: "string" },
  price: { type: "number", required: true, min: 0 },
  wholesale_price: { type: "number", min: 0 },
  cost: { type: "number", required: true, min: 0 },
  reorder_level: { type: "number", min: 0 },
  track_batches: { type: "number" },
  track_serials: { type: "number" },
};

type UnitInput = { name?: unknown; multiplier?: unknown; price?: unknown; wholesalePrice?: unknown; barcode?: unknown };

const toColumns = (body: Row): Row => ({
  ...body,
  reorder_level: body.reorderLevel,
  wholesale_price: body.wholesalePrice,
  track_batches: body.trackBatches === undefined ? undefined : body.trackBatches ? 1 : 0,
  track_serials: body.trackSerials === undefined ? undefined : body.trackSerials ? 1 : 0,
});

function parseUnits(units: unknown) {
  if (units === undefined) return undefined;
  if (!Array.isArray(units)) throw new ApiError("Units must be a list");

  const names = new Set<string>();

  return (units as UnitInput[]).map((unit) => {
    const name = String(unit.name ?? "").trim();
    const multiplier = Number(unit.multiplier);
    const price = Number(unit.price);
    const wholesale = unit.wholesalePrice === "" || unit.wholesalePrice == null ? null : Number(unit.wholesalePrice);
    const barcode = String(unit.barcode ?? "").trim() || null;

    if (!name) throw new ApiError("Each pack size needs a name");
    if (names.has(name.toLowerCase())) throw new ApiError(`Pack size "${name}" is listed twice`);
    if (!Number.isInteger(multiplier) || multiplier < 2) throw new ApiError(`${name}: units per pack must be a whole number of 2 or more`);
    if (!(price >= 0)) throw new ApiError(`${name}: price must be 0 or more`);
    if (wholesale !== null && !(wholesale >= 0)) throw new ApiError(`${name}: wholesale price must be 0 or more`);

    names.add(name.toLowerCase());
    return [name, multiplier, price, wholesale, barcode] as const;
  });
}

async function saveUnits(connection: PoolConnection, productId: number, units: ReturnType<typeof parseUnits>) {
  if (!units) return;
  await connection.query("DELETE FROM product_units WHERE product_id = ?", [productId]);
  if (units.length > 0) {
    await connection.query(
      "INSERT INTO product_units (product_id, name, multiplier, price, wholesale_price, barcode) VALUES ?",
      [units.map((unit) => [productId, ...unit])]
    );
  }
}

export const GET = handle(async (request) => {
  const warehouseId = Number(request.nextUrl.searchParams.get("warehouseId")) || null;

  const [rows, units] = await Promise.all([
    queryRows<Row & { id: number; stock: number; reorderLevel: number; available: number; trackBatches: number; trackSerials: number }>(
      `SELECT p.id, p.name, p.sku, COALESCE(p.barcode, '') AS barcode, p.category, COALESCE(p.brand, '') AS brand,
              p.price, p.wholesale_price AS wholesalePrice, p.cost, p.reorder_level AS reorderLevel, p.color,
              p.track_batches AS trackBatches, p.track_serials AS trackSerials,
              CAST(COALESCE(SUM(s.quantity), 0) AS SIGNED) AS stock,
              CAST(COALESCE(SUM(CASE WHEN ? IS NULL OR s.warehouse_id = ? THEN s.quantity - s.reserved END), 0) AS SIGNED) AS available
       FROM products p
       LEFT JOIN stock_levels s ON s.product_id = p.id
       GROUP BY p.id
       ORDER BY p.name`,
      [warehouseId, warehouseId]
    ),
    queryRows<{ productId: number }>(
      `SELECT id, product_id AS productId, name, multiplier, price, wholesale_price AS wholesalePrice, COALESCE(barcode, '') AS barcode
       FROM product_units ORDER BY multiplier`
    ),
  ]);

  return NextResponse.json({
    success: true,
    data: rows.map((row) => ({
      ...row,
      trackBatches: Boolean(row.trackBatches),
      trackSerials: Boolean(row.trackSerials),
      units: units.filter((unit) => unit.productId === row.id),
      status: row.stock <= 0 ? "Out of Stock" : row.stock <= row.reorderLevel ? "Low Stock" : "Active",
    })),
  });
});

export const POST = handle(async (request) => {
  const body = await request.json();
  const values = pickFields(toColumns(body), fields);
  const units = parseUnits(body.units);
  const openingStock = Number(body.openingStock || 0);
  const warehouseId = Number(body.warehouseId);

  if (!Number.isInteger(openingStock) || openingStock < 0) throw new ApiError("Opening stock must be a whole number of 0 or more");
  if (openingStock > 0 && !warehouseId) throw new ApiError("Select the warehouse that holds the opening stock");

  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>("INSERT INTO products SET ?", [values]);
    await connection.query("UPDATE products SET color = ? WHERE id = ?", [colors[result.insertId % colors.length], result.insertId]);
    await saveUnits(connection, result.insertId, units);

    if (openingStock > 0) {
      const batchNumber = String(body.batchNumber ?? "").trim();
      await changeStock(connection, {
        productId: result.insertId,
        warehouseId,
        delta: openingStock,
        type: "Opening Stock",
        reference: "OPENING",
        notes: "Opening balance",
        batches: batchNumber
          ? [{ number: batchNumber, expiry: String(body.expiryDate ?? "") || null, quantity: openingStock }]
          : undefined,
      });
    }

    return result.insertId;
  });

  return NextResponse.json({ success: true, data: { id } }, { status: 201 });
});

export const PUT = handle(async (request) => {
  const body = await request.json();
  const id = requireId(request, body);
  const values = pickFields(toColumns(body), fields, true);
  const units = parseUnits(body.units);

  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>("UPDATE products SET ? WHERE id = ?", [values, id]);
    if (result.affectedRows === 0) throw new ApiError("Product not found", 404);
    await saveUnits(connection, id, units);
  });

  return NextResponse.json({ success: true });
});

export const DELETE = handle(async (request) => {
  const id = requireId(request);
  const [{ units } = { units: 0 }] = await queryRows<{ units: number }>(
    "SELECT COALESCE(SUM(quantity), 0) AS units FROM stock_levels WHERE product_id = ?",
    [id]
  );

  if (units > 0) throw new ApiError(`This product still has ${units} units in stock. Adjust stock to zero before deleting it.`, 409);

  const [result] = await db.query<ResultSetHeader>("DELETE FROM products WHERE id = ?", [id]);
  if (result.affectedRows === 0) throw new ApiError("Product not found", 404);

  return NextResponse.json({ success: true });
});
