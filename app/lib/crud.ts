import { NextRequest, NextResponse } from "next/server";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import db, { ensureSchema } from "./db";
import { findSessionUser, runAsUser } from "./auth";
import { canCallApi, SESSION_COOKIE } from "./permissions";

export type Row = Record<string, unknown>;

export type FieldSpec = {
  type: "string" | "number" | "date";
  required?: boolean;
  options?: readonly string[];
  min?: number;
};

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const CONNECTION_ERRORS = ["ECONNREFUSED", "ECONNRESET", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"];

export function dbErrorMessage(error: unknown, fallback: string) {
  const { code, fatal, message } = error as { code?: string; fatal?: boolean; message?: string };

  if (CONNECTION_ERRORS.includes(code ?? "") || fatal || /closed state/.test(message ?? "")) {
    return "Lost connection to the MySQL database. Check that MySQL is running in XAMPP, then try again — nothing was saved.";
  }

  if (code === "ER_LOCK_WAIT_TIMEOUT" || code === "ER_LOCK_DEADLOCK") {
    return "The database was busy with another transaction. Please try again — nothing was saved.";
  }

  return fallback;
}

function assertSameOrigin(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && (URL.canParse(origin) ? new URL(origin).host : origin) !== request.headers.get("host")) {
    throw new ApiError("Cross-site requests are not allowed", 403);
  }
}

/**
 * Wraps a route handler with schema setup, error handling and auth.
 * - "module" (default): signed-in user whose role may call this API path + method (see permissions.ts)
 * - "authenticated": any signed-in user
 * - "public": no session required
 */
export function handle(
  fn: (request: NextRequest) => Promise<Response>,
  { access = "module" }: { access?: "module" | "authenticated" | "public" } = {}
) {
  return async (request: NextRequest) => {
    try {
      assertSameOrigin(request);
      await ensureSchema();

      if (access === "public") return await fn(request);

      const user = await findSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
      if (!user) throw new ApiError("Your session has expired. Please sign in again.", 401);

      if (access === "module" && !canCallApi(user.role, request.nextUrl.pathname, request.method)) {
        throw new ApiError(`Your role (${user.role}) is not allowed to perform this action.`, 403);
      }

      return await runAsUser(user, () => fn(request));
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ success: false, message: error.message }, { status: error.status });
      }

      const code = (error as { code?: string }).code;

      if (code === "ER_DUP_ENTRY") {
        const key = /for key '(?:[^.']*\.)?([^']+)'/.exec(String((error as Error).message))?.[1];
        const field = key?.replace(/^uq_|_UNIQUE$/g, "").replace(/_/g, " ");
        return NextResponse.json(
          { success: false, message: `A record with this ${field && field !== "PRIMARY" ? field : "value"} already exists` },
          { status: 409 }
        );
      }

      if (code === "ER_ROW_IS_REFERENCED_2" || code === "ER_ROW_IS_REFERENCED") {
        return NextResponse.json(
          { success: false, message: "This record is linked to other records (stock, orders or history) and cannot be deleted. Mark it inactive instead." },
          { status: 409 }
        );
      }

      console.error(`${request.method} ${request.nextUrl.pathname} ERROR:`, error);

      return NextResponse.json(
        {
          success: false,
          message: dbErrorMessage(error, "Request failed"),
          error: process.env.NODE_ENV === "development" ? String(error) : undefined,
        },
        { status: 500 }
      );
    }
  };
}

export function pickFields(body: Row, fields: Record<string, FieldSpec>, partial = false) {
  const values: Row = {};

  for (const [key, spec] of Object.entries(fields)) {
    const raw = body[key];
    const empty = raw === undefined || raw === null || raw === "";

    if (empty) {
      if (spec.required && (!partial || raw !== undefined)) throw new ApiError(`${key.replace(/_/g, " ")} is required`);
      if (partial && raw !== undefined) values[key] = null;
      continue;
    }

    if (spec.type === "number") {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new ApiError(`${key.replace(/_/g, " ")} must be a number`);
      if (spec.min !== undefined && number < spec.min) {
        throw new ApiError(`${key.replace(/_/g, " ")} must be at least ${spec.min}`);
      }
      values[key] = number;
    } else {
      const text = String(raw).trim();
      if (spec.options && !spec.options.includes(text)) {
        throw new ApiError(`${key.replace(/_/g, " ")} must be one of: ${spec.options.join(", ")}`);
      }
      if (spec.type === "date" && Number.isNaN(Date.parse(text))) {
        throw new ApiError(`${key.replace(/_/g, " ")} must be a valid date`);
      }
      values[key] = text;
    }
  }

  return values;
}

export async function queryRows<T = Row>(sql: string, params: unknown[] = [], conn: Pick<Pool, "query"> = db) {
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export function requireId(request: NextRequest, body?: Row) {
  const id = Number(body?.id ?? request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError("A valid id is required");
  return id;
}

export function crudRoutes({
  table,
  fields,
  codeColumn,
  codePrefix,
  listSql,
  onChange,
}: {
  table: string;
  fields: Record<string, FieldSpec>;
  codeColumn?: string;
  codePrefix?: string;
  listSql?: string;
  onChange?: (rows: Row[]) => Promise<void>;
}) {
  const findOne = async (id: number) => {
    const [row] = await queryRows(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw new ApiError("Record not found", 404);
    return row;
  };

  const GET = handle(async () =>
    NextResponse.json({
      success: true,
      data: await queryRows(listSql ?? `SELECT * FROM ${table} ORDER BY id DESC`),
    })
  );

  const POST = handle(async (request) => {
    const values = pickFields(await request.json(), fields);

    if (codeColumn) values[codeColumn] = `TMP-${crypto.randomUUID()}`;

    const [result] = await db.query<ResultSetHeader>(`INSERT INTO ${table} SET ?`, [values]);

    if (codeColumn) {
      await db.query(
        `UPDATE ${table} SET ${codeColumn} = CONCAT(?, '-', LPAD(id, 3, '0')) WHERE id = ?`,
        [codePrefix, result.insertId]
      );
    }

    const row = await findOne(result.insertId);
    await onChange?.([row]);

    return NextResponse.json({ success: true, data: row }, { status: 201 });
  });

  const PUT = handle(async (request) => {
    const body = await request.json();
    const id = requireId(request, body);
    const before = await findOne(id);
    const values = pickFields(body, fields, true);

    if (Object.keys(values).length === 0) throw new ApiError("Nothing to update");

    await db.query(`UPDATE ${table} SET ? WHERE id = ?`, [values, id]);

    const row = await findOne(id);
    await onChange?.([before, row]);

    return NextResponse.json({ success: true, data: row });
  });

  const DELETE = handle(async (request) => {
    const id = requireId(request);
    const before = await findOne(id);

    await db.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
    await onChange?.([before]);

    return NextResponse.json({ success: true });
  });

  return { GET, POST, PUT, DELETE };
}
