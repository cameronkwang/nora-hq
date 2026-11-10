/**
 * Runs on `npm run build` (and `npm run db:migrate`). With DATABASE_URL set it migrates + seeds Neon;
 * without it, it's a no-op (local dev migrates the embedded PGlite automatically on first request).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as schema from "../src/lib/schema";
import { seed } from "../src/lib/seed";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] DATABASE_URL not set — skipping (local dev uses PGlite).");
    return;
  }
  const db = drizzle(neon(url), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  console.log("[migrate] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
