import { NextResponse } from "next/server";
import { ApiError, handle, queryRows } from "@/app/lib/crud";

const ranges = {
  "7d": { days: 7, bucket: "%Y-%m-%d" },
  "30d": { days: 30, bucket: "%x-W%v" },
  year: { days: 0, bucket: "%Y-%m" },
} as const;

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function buckets(range: keyof typeof ranges) {
  const now = new Date();

  if (range === "year") {
    return Array.from({ length: now.getMonth() + 1 }, (_, month) => {
      const date = new Date(now.getFullYear(), month, 1);
      return { key: iso(date).slice(0, 7), label: date.toLocaleDateString("en-US", { month: "short" }) };
    });
  }

  if (range === "7d") {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index);
      return { key: iso(date), label: date.toLocaleDateString("en-US", { weekday: "short" }) };
    });
  }

  const weeks = new Map<string, string>();
  for (let offset = 29; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const thursday = new Date(date);
    thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const firstThursday = new Date(thursday.getFullYear(), 0, 4);
    const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
    const key = `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
    if (!weeks.has(key)) weeks.set(key, `Wk of ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`);
  }
  return [...weeks].map(([key, label]) => ({ key, label }));
}

export const GET = handle(async (request) => {
  const range = (request.nextUrl.searchParams.get("range") ?? "7d") as keyof typeof ranges;
  if (!(range in ranges)) throw new ApiError("range must be one of: 7d, 30d, year");

  const { days, bucket } = ranges[range];
  const since = days ? `CURDATE() - INTERVAL ${days - 1} DAY` : "MAKEDATE(YEAR(CURDATE()), 1)";

  const [trend, products, categories, [totals]] = await Promise.all([
    queryRows<{ bucket: string; value: number }>(
      `SELECT bucket, SUM(value) AS value FROM (
         SELECT DATE_FORMAT(created_at, ?) AS bucket, total AS value FROM sales
         WHERE status = 'COMPLETED' AND created_at >= ${since}
         UNION ALL
         SELECT DATE_FORMAT(issued_date, ?) AS bucket, total AS value FROM invoices
         WHERE issued_date >= ${since}
       ) t GROUP BY bucket`,
      [bucket, bucket]
    ),
    queryRows<{ name: string; units: number; revenue: number }>(
      `SELECT i.product_name AS name, CAST(SUM(i.quantity) AS SIGNED) AS units, SUM(i.line_total) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE s.status = 'COMPLETED' AND s.created_at >= ${since}
       GROUP BY i.product_name ORDER BY revenue DESC LIMIT 5`
    ),
    queryRows<{ name: string; revenue: number }>(
      `SELECT COALESCE(p.category, 'Other') AS name, SUM(i.line_total) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE s.status = 'COMPLETED' AND s.created_at >= ${since}
       GROUP BY name ORDER BY revenue DESC`
    ),
    queryRows<{ revenue: number; cost: number; units: number; transactions: number }>(
      `SELECT COALESCE(SUM(i.line_total), 0) AS revenue,
              COALESCE(SUM(i.quantity * p.cost), 0) AS cost,
              CAST(COALESCE(SUM(i.quantity), 0) AS SIGNED) AS units,
              COUNT(DISTINCT s.id) AS transactions
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE s.status = 'COMPLETED' AND s.created_at >= ${since}`
    ),
  ]);

  const byBucket = new Map(trend.map((row) => [row.bucket, Number(row.value)]));
  const categoryTotal = categories.reduce((sum, row) => sum + Number(row.revenue), 0);

  return NextResponse.json({
    success: true,
    data: {
      trend: buckets(range).map(({ key, label }) => ({ label, value: byBucket.get(key) ?? 0 })),
      topProducts: products,
      categoryShare: categories.map((row) => ({
        name: row.name,
        share: categoryTotal ? Math.round((Number(row.revenue) / categoryTotal) * 100) : 0,
      })),
      grossMargin: totals.revenue ? Math.round(((totals.revenue - totals.cost) / totals.revenue) * 1000) / 10 : 0,
      unitsSold: totals.units,
      transactions: totals.transactions,
    },
  });
});
