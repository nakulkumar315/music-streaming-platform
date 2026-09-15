import { anonymizeAccount } from "../modules/privacy/account-privacy.service";

function value(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const userId = Number(value("user-id"));
  const reason = String(value("reason") || "").trim();
  const confirmation = String(value("confirm") || "");

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("--user-id must be a positive integer");
  }
  if (!reason) throw new Error("--reason is required");
  if (confirmation !== `ANONYMIZE-${userId}`) {
    throw new Error(`Destructive confirmation required: --confirm=ANONYMIZE-${userId}`);
  }

  const result = await anonymizeAccount(userId, reason, { role: "system" });
  console.log(JSON.stringify({ operation: "phase09b-account-anonymization", ...result }, null, 2));
}

main().catch((error) => {
  console.error("Phase 09B account anonymization failed", error);
  process.exit(1);
});
