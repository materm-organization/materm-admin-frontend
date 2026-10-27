import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Request-independent security headers (doc/10 R-008), for every response. Kept INLINE (no import from src/):
// the Docker runner stage ships only this file and src/i18n, and `next start` re-evaluates next.config.ts.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project so Next's lockfile
  // root-inference can't pick up an unrelated package-lock.json in a parent
  // directory.
  turbopack: {
    root: path.join(__dirname),
  },
  // The Content-Security-Policy itself carries a per-request nonce, so it is set in src/proxy.ts
  // (policy: src/lib/security/csp.ts).
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);
