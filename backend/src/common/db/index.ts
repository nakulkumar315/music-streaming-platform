import "dotenv/config";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV !== "production"
    ? "postgresql://localhost:5432/music_platform_dev"
    : undefined);
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is required. Database configuration must be present before the backend starts."
  );
}

function sslConfig(url: string | undefined) {
  if (!url || url.includes("sslmode=disable")) return false;
  return { rejectUnauthorized: false } as const;
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslConfig(databaseUrl),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 5,
});

const readDbUrl = process.env.DATABASE_URL_REPLICA || databaseUrl;

export const poolRead = new Pool({
  connectionString: readDbUrl,
  ssl: sslConfig(readDbUrl),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 5,
});

pool.on("error", (error) => {
  console.error("[DB] Unexpected error on primary idle client", error);
});

poolRead.on("error", (error) => {
  console.error("[DB Read] Unexpected error on read idle client", error);
});

/**
 * Connection establishment is intentionally not performed as an import side
 * effect. The application bootstrap explicitly awaits schema readiness before
 * opening its HTTP listener; migration scripts own all schema mutation.
 */
