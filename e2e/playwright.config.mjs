import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { ROOT, PORT, BASE_URL, childEnv } from "./env.mjs";

export default defineConfig({
  testDir: "tests",
  globalTeardown: "./teardown.mjs",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The backend serves the built frontend, the API and images on one origin.
  webServer: {
    command: "node src/server.js",
    cwd: path.join(ROOT, "backend"),
    url: `${BASE_URL}/api/health`,
    env: { ...childEnv, PORT: String(PORT), CORS_ORIGIN: BASE_URL, NODE_ENV: "test" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
