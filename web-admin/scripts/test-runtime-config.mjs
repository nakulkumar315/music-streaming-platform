import assert from "node:assert/strict";
import { validateProductionWebConfig } from "./runtime-config.mjs";

function rejects(env, fragment) {
  assert.throws(() => validateProductionWebConfig(env), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(fragment, "i"));
    return true;
  });
}

rejects({}, "required");
rejects({ VITE_API_BASE_URL: "http://localhost:8000" }, "https");
rejects({ VITE_API_BASE_URL: "https://localhost:8000" }, "localhost");
rejects({ VITE_API_BASE_URL: "http://api.example.test" }, "https");
rejects({ VITE_API_BASE_URL: "https://api.example.test/v1" }, "origin");
rejects({ VITE_API_BASE_URL: "https://api.example.test", VITE_SENTRY_DSN: "https://example.invalid/1" }, "placeholder");

assert.deepEqual(
  validateProductionWebConfig({ VITE_API_BASE_URL: "https://api.music.example.net" }),
  { apiBaseUrl: "https://api.music.example.net" }
);

console.log("web-admin runtime config contract tests passed");
