import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export * from "drizzle-orm";
export * from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
export const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10), prepare: false });
export const db = drizzle(sql, { schema });
export type Database = typeof db;
