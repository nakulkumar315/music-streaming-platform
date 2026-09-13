import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function main() {
  const adminAuth = read("backend/src/routes/admin/auth.ts");
  const subscriptionConfigController = read(
    "backend/src/controllers/subscriptionConfigController.ts"
  );
  const adminApp = read("web-admin/src/App.tsx");
  const adminGate = read("web-admin/src/components/AdminSessionGate.tsx");
  const adminSession = read("web-admin/src/services/adminSession.ts");
  const adminHttp = read("web-admin/src/services/http.ts");
  const adminRuntime = read("web-admin/src/config/runtime.ts");
  const adminMain = read("web-admin/src/main.tsx");
  const adminLogin = read("web-admin/src/pages/AdminLoginPage.tsx");
  const adminSubscriptionSettings = read(
    "web-admin/src/pages/AdminSubscriptionSettingsPage.tsx"
  );
  const artistSession = read("web-artist/src/services/artistSession.ts");
  const artistHttp = read("web-artist/src/services/http.ts");
  const artistRuntime = read("web-artist/src/config/runtime.ts");
  const artistShell = read("web-artist/src/components/ArtistShell.tsx");
  const artistMain = read("web-artist/src/main.tsx");

  assert.equal(
    adminAuth.includes('router.get("/session", requireAuth'),
    true,
    "Admin portal must validate the current server-backed session before privileged navigation"
  );
  assert.equal(
    adminAuth.includes("PRIVILEGED_ROLES.has(role)"),
    true,
    "Admin session endpoint must validate the current server-side privileged role"
  );
  assert.equal(
    adminApp.includes("<AdminSessionGate />"),
    true,
    "All protected admin routes must be nested behind the server session gate"
  );
  assert.equal(
    adminGate.includes('http.get("/api/v1/admin/session")'),
    true,
    "Admin UI role/status must be refreshed from the backend"
  );

  for (const [label, source] of [
    ["admin", adminSession],
    ["artist", artistSession],
  ] as const) {
    assert.equal(
      source.includes("sessionStorage.setItem(TOKEN_KEY"),
      true,
      `${label} bearer tokens must be tab-scoped rather than durably persisted`
    );
    assert.equal(
      source.includes("localStorage.removeItem(TOKEN_KEY)"),
      true,
      `${label} session helper must remove the legacy durable token`
    );
  }

  assert.equal(
    adminLogin.includes('localStorage.setItem("adminToken"'),
    false,
    "Admin login page must not persist privileged bearer credentials directly"
  );
  assert.equal(
    adminHttp.includes('failure.status === 403 && failure.code === "ACCOUNT_INACTIVE"'),
    true,
    "Admin inactive-account denial must terminate the browser session"
  );
  assert.equal(
    adminHttp.includes("if (failure.status === 403)"),
    false,
    "Generic admin 403 authorization failures must not become logout loops"
  );
  assert.equal(
    adminSubscriptionSettings.includes('localStorage.removeItem("adminToken"'),
    false,
    "Admin subscription settings must not implement its own token/logout path"
  );
  assert.equal(
    adminSubscriptionSettings.includes("await load();"),
    true,
    "Admin subscription settings must refresh canonical server state after save"
  );
  assert.equal(
    subscriptionConfigController.includes('message: "currency must be INR"'),
    true,
    "Subscription configuration must keep the canonical INR currency boundary"
  );
  assert.equal(
    subscriptionConfigController.includes("Math.round(amount * 100)"),
    true,
    "Subscription configuration must reject values that cannot map cleanly to paise"
  );
  assert.equal(
    subscriptionConfigController.includes('code: "INVALID_SUBSCRIPTION_CONFIG"'),
    true,
    "Invalid privileged pricing configuration must fail closed with an explicit code"
  );

  assert.equal(
    artistHttp.includes("delete res.data.token"),
    true,
    "Artist bearer credentials must be consumed by the session boundary before page components receive the response"
  );
  assert.equal(
    artistHttp.includes('failure.status === 403 && failure.code === "ACCOUNT_INACTIVE"'),
    true,
    "Artist 403 must only clear the session for the canonical inactive-account condition"
  );
  assert.equal(
    artistShell.includes('failure.code === "ARTIST_NOT_APPROVED"'),
    true,
    "Artist approval denial must route to approval state without treating it as authentication loss"
  );

  for (const [label, runtime] of [
    ["admin", adminRuntime],
    ["artist", artistRuntime],
  ] as const) {
    assert.equal(runtime.includes("VITE_API_BASE_URL is required in production"), true, `${label} production API URL must be required`);
    assert.equal(runtime.includes("must not target localhost in production"), true, `${label} production API URL must reject localhost`);
    assert.equal(runtime.includes("must use https:// in production"), true, `${label} production API URL must require HTTPS`);
  }

  assert.equal(adminMain.includes("replayIntegration"), false, "Admin Sentry must not enable session replay for privileged UI");
  assert.equal(artistMain.includes("replayIntegration"), false, "Artist Sentry must not enable session replay for privileged UI");

  console.log("Phase 07 privileged web hardening contract checks passed.");
}

main();
