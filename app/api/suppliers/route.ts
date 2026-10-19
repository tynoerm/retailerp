import { crudRoutes } from "@/app/lib/crud";

export const { GET, POST, PUT, DELETE } = crudRoutes({
  table: "suppliers",
  codeColumn: "code",
  codePrefix: "SUP",
  fields: {
    name: { type: "string", required: true },
    contact: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    category: { type: "string" },
    balance: { type: "number", min: 0 },
    status: { type: "string", options: ["Active", "Inactive"] },
  },
  listSql: `
    SELECT s.*, COUNT(po.id) AS order_count
    FROM suppliers s
    LEFT JOIN purchase_orders po ON po.supplier_id = s.id
    GROUP BY s.id
    ORDER BY s.id DESC
  `,
});
