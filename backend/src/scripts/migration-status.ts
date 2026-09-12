import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../common/db";

const migrationsDir = path.resolve(process.cwd(), "db", "migrations");

async function main(): Promise<void> {
  const files = fs.existsSync(migrationsDir)
    ? fs
        .readdirSync(migrationsDir)
        .filter((name) => /^\d{8}_\d{4}_[a-z0-9_\-]+\.sql$/i.test(name))
        .sort()
    : [];

  const table = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`
  );

  if (!table.rows[0]?.exists) {
    console.log("[DB Migrate] schema_migrations does not exist");
    for (const file of files) console.log(`[PENDING] ${file.replace(/\.sql$/i, "")}`);
    await pool.end();
    process.exit(files.length > 0 ? 1 : 0);
  }

  const rows = await pool.query<{ version: string; applied_at: Date }>(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version"
  );
  const applied = new Map(rows.rows.map((row) => [row.version, row.applied_at]));

  let pending = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/i, "");
    const appliedAt = applied.get(version);
    if (appliedAt) {
      console.log(`[APPLIED] ${version} ${new Date(appliedAt).toISOString()}`);
    } else {
      pending += 1;
      console.log(`[PENDING] ${version}`);
    }
  }

  await pool.end();
  if (pending > 0) {
    console.error(`[DB Migrate] ${pending} migration(s) pending`);
    process.exit(1);
  }
  console.log("[DB Migrate] No pending migrations");
}

main().catch(async (error) => {
  console.error("[DB Migrate] Status check failed:", error instanceof Error ? error.message : error);
  try {
    await pool.end();
  } finally {
    process.exit(1);
  }
});
