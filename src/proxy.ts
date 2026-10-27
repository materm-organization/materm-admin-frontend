import { type NextRequest, NextResponse } from "next/server";

import {
  apiOriginFromBaseUrl,
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/security/csp";

// Sets the per-request Content-Security-Policy with a fresh nonce (doc/10 R-008; the policy is documented in
// lib/security/csp.ts). This is NOT an auth gate — access control stays client-side in `(protected)`
// (RoutePermissionGuard) and, for real, on the API. The nonce needs dynamic rendering; the root layout
// already reads the locale cookie, so every page is dynamic anyway.
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    apiOrigin: apiOriginFromBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
  });

  // Next reads the nonce from the CSP *request* header and applies it to its own scripts; `x-nonce` is for
  // our code (next-themes in the root layout).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only: not static assets / image optimisation / the favicon, and not link prefetches.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
