import "dotenv/config";
import { pool } from "../common/db";
import { assertDatabaseSchemaReady } from "../common/db/schema-readiness";

async function main(): Promise<void> {
  const result = await assertDatabaseSchemaReady();
  console.log(
    `[DB Schema] READY version=${result.version} database=${result.database} schema=${result.schema}`
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(
    "[DB Schema] NOT READY:",
    error instanceof Error ? error.message : error
  );
  try {
    await pool.end();
  } finally {
    process.exit(1);
  }
});
