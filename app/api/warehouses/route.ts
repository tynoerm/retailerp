import { NextResponse } from "next/server";
import { crudRoutes, handle, queryRows, type Row } from "@/app/lib/crud";

const routes = crudRoutes({
  table: "warehouses",
  fields: {
    name: { type: "string", required: true },
    code: { type: "string", required: true },
    location: { type: "string", required: true },
    manager: { type: "string", required: true },
    phone: { type: "string" },
    capacity: { type: "number", required: true, min: 1 },
    type: { type: "string", options: ["Main", "Branch", "Cold Storage", "Distribution"] },
    status: { type: "string", options: ["Active", "Inactive"] },
  },
});

export const GET = handle(async () => {
  const rows = await queryRows<Row & { capacity: number; units: number; status: string }>(`
    SELECT w.id, w.name, w.code, w.location, w.manager, COALESCE(w.phone, '') AS phone, w.capacity, w.type, w.status,
           COUNT(DISTINCT CASE WHEN s.quantity > 0 THEN s.product_id END) AS products,
           CAST(COALESCE(SUM(s.quantity), 0) AS SIGNED) AS units,
           COALESCE(SUM(s.quantity * p.cost), 0) AS stockValue
    FROM warehouses w
    LEFT JOIN stock_levels s ON s.warehouse_id = w.id
    LEFT JOIN products p ON p.id = s.product_id
    GROUP BY w.id
    ORDER BY w.id
  `);

  return NextResponse.json({
    success: true,
    data: rows.map((row) => {
      const occupied = Math.round((row.units / row.capacity) * 100);
      return { ...row, occupied, status: row.status === "Active" && occupied >= 90 ? "At Capacity" : row.status };
    }),
  });
});

export const { POST, PUT, DELETE } = routes;
