import { validateProductionWebConfig } from "./runtime-config.mjs";

try {
  const result = validateProductionWebConfig(process.env);
  console.log(`[web-artist config] production API origin validated: ${result.apiBaseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
