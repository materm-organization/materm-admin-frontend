import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Unit + component tests (doc/07 section 7): pure logic in `lib/` and `hooks/`, and components with Testing
// Library; HTTP is mocked with MSW (src/test/msw-server.ts). Run: `npm run test`.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "tests/e2e/**"], // the browser E2E suite has its own runner (npm run e2e)
    css: false,
    restoreMocks: true,
    // Measured alone, the slowest test takes 3.3 s and nearly all finish under 2.5 s; with two suites running at once (CPU
    // oversubscribed ~2x) 148 tests hit the 5 s default and 16 more hit 15 s in one round. Heavy jsdom form renders scale
    // with CPU, so give them headroom; a genuine hang still ends the test, just 30 s later.
    testTimeout: 30_000,
  },
});
