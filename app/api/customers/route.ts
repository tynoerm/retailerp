import { crudRoutes } from "@/app/lib/crud";

export const { GET, POST, PUT, DELETE } = crudRoutes({
  table: "customers",
  codeColumn: "code",
  codePrefix: "CUS",
  fields: {
    name: { type: "string", required: true },
    email: { type: "string" },
    phone: { type: "string" },
    address: { type: "string" },
    status: { type: "string", options: ["Active", "VIP", "Inactive"] },
    price_tier: { type: "string", options: ["Retail", "Wholesale"] },
  },
  listSql: `
    SELECT c.*,
      COUNT(i.id) AS invoice_count,
      COALESCE(SUM(i.total), 0) AS total_billed,
      COALESCE(SUM(i.total - i.amount_paid), 0) AS balance,
      MAX(i.issued_date) AS last_invoice
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    GROUP BY c.id
    ORDER BY c.id DESC
  `,
});
