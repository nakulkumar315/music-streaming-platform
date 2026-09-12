import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "../common/db";

const MIGRATION_LOCK_KEY = 593_001_203;
const MIGRATIONS_DIR = path.resolve(process.cwd(), "db", "migrations");

function migrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migration directory not found: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{8}_\d{4}_[a-z0-9_\-]+\.sql$/i.test(name))
    .sort();
}

function versionFromFile(fileName: string): string {
  return fileName.replace(/\.sql$/i, "");
}

function checksum(sql: string): string {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(200) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version"
    );
    const applied = new Map(
      appliedRows.rows.map((row) => [row.version, String(row.checksum).trim()])
    );

    const files = migrationFiles();
    if (files.length === 0) {
      throw new Error("No migration files found");
    }

    for (const file of files) {
      const version = versionFromFile(file);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const sqlChecksum = checksum(sql);
      const recordedChecksum = applied.get(version);

      if (recordedChecksum) {
        if (recordedChecksum !== sqlChecksum) {
          throw new Error(
            `Applied migration ${version} was modified. Expected checksum ${recordedChecksum}, found ${sqlChecksum}. Create a new migration instead of editing an applied one.`
          );
        }
        console.log(`[DB Migrate] ${version} already applied`);
        continue;
      }

      console.log(`[DB Migrate] Applying ${version}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations(version, checksum, applied_at)
           VALUES ($1, $2, now())`,
          [version, sqlChecksum]
        );
        await client.query("COMMIT");
        console.log(`[DB Migrate] Applied ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("[DB Migrate] Database is up to date");
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch (unlockError) {
        console.error("[DB Migrate] Failed to release advisory lock:", unlockError);
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[DB Migrate] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
