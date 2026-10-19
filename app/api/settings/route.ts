import { NextResponse } from "next/server";
import db from "@/app/lib/db";
import { ApiError, handle } from "@/app/lib/crud";
import { defaultSettings, getSettings } from "@/app/lib/settings";

export const GET = handle(async () => NextResponse.json({ success: true, data: await getSettings() }));

export const PUT = handle(async (request) => {
  const body = await request.json();

  const entries = Object.entries(defaultSettings)
    .filter(([key]) => key in body)
    .map(([key, fallback]) => {
      let value = body[key];
      if (typeof value !== typeof fallback) throw new ApiError(`Invalid value for ${key}`);

      if (key === "currencies") {
        if (!Array.isArray(value)) throw new ApiError("Invalid value for currencies");
        const seen = new Set<string>();
        value = value.map((item: { code?: unknown; rate?: unknown }) => {
          const code = String(item.code ?? "").trim().toUpperCase();
          const rate = Number(item.rate);
          if (!/^[A-Z]{3}$/.test(code)) throw new ApiError(`"${code}" is not a 3-letter currency code`);
          if (seen.has(code)) throw new ApiError(`${code} is listed twice`);
          if (!Number.isFinite(rate) || rate < 0) throw new ApiError(`Exchange rate for ${code} must be 0 or more`);
          seen.add(code);
          return { code, rate };
        });
      }

      if (["taxRate", "laybyMinDepositPercent"].includes(key) && !(Number(value) >= 0 && Number(value) <= 100)) {
        throw new ApiError(`${key === "taxRate" ? "Tax rate" : "Lay-by deposit"} must be between 0 and 100`);
      }

      return [key, JSON.stringify(value)];
    });

  if (entries.length === 0) throw new ApiError("Nothing to update");

  await db.query(
    "INSERT INTO settings (setting_key, setting_value) VALUES ? ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [entries]
  );

  return NextResponse.json({ success: true, data: await getSettings() });
});
