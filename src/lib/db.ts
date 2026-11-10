import "server-only";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Production: Neon Postgres over HTTP (DATABASE_URL).
 * Local dev without DATABASE_URL: embedded PGlite stored in ./.data/pglite, migrated on first use.
 * Both expose the same drizzle query API, so the app types against the Neon flavour.
 */
export type DB = NeonHttpDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) return drizzleNeon(neon(url), { schema });
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. In Vercel: Storage → Create Database → Neon → connect it to this project, then redeploy.");
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { seed } = await import("./seed");
  const dir = process.env.PGLITE_DIR ?? "./.data/pglite";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db as unknown as DB);
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!globalForDb.__db) {
    globalForDb.__db = create().catch((e) => {
      globalForDb.__db = undefined; // don't cache a failed init
      throw e;
    });
  }
  return globalForDb.__db;
}

export { schema };
