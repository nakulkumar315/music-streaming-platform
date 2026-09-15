import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`[phase10] ${message}`);
};

const app = read("src/app.ts");
const env = read("src/config/env.validation.ts");
const onboarding = read("src/modules/artist/artist-onboarding.routes.ts");
const publicMetadata = read("src/modules/artist/artist-public-metadata.routes.ts");
const packageJson = JSON.parse(read("package.json"));

const metadataMount = app.indexOf('app.use("/api/v1/artist", artistPublicMetadataRoutes)');
const legacyMount = app.indexOf('app.use("/api/v1/artist", artistRoutes)');
assert(metadataMount >= 0 && legacyMount > metadataMount, "strict public artist metadata must precede the legacy artist router");
assert(app.includes('.split("?", 1)[0]'), "global error logging must strip request query strings");
assert(!publicMetadata.includes("safeRows"), "public onboarding metadata must not use fail-open DB helpers");
assert(publicMetadata.includes("COMMISSION_PLANS_UNAVAILABLE"), "commission-plan DB failures must be explicit");
assert(publicMetadata.includes("TERMS_UNAVAILABLE"), "terms DB failures must be explicit");

assert(env.includes('envStr("SIGNATURE_ENCRYPTION_KEY")'), "signature encryption key must be required by canonical runtime validation");
assert(onboarding.includes('process.env.SIGNATURE_ENCRYPTION_KEY || ""'), "authoritative onboarding must require configured signature encryption");
assert(!onboarding.includes("return signature"), "authoritative onboarding must never fall back to plaintext signatures");

const unit = String(packageJson?.scripts?.["test:unit"] || "");
for (const required of [
  "test:payment-integrity",
  "test:auth-hardening",
  "test:content-media-governance",
  "test:phase07-web-contract",
  "test:phase08-operational",
  "test:phase09-distribution-domain",
  "test:phase09a-adaptive-media",
  "test:phase09b-privacy-recovery",
]) {
  assert(unit.includes(required), `test:unit must retain ${required}`);
}

console.log("Phase 10 final hardening source contract: PASS");
