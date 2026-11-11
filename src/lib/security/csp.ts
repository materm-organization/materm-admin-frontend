// Content-Security-Policy of the admin app (doc/10 R-008, doc/01 Q-22): the JWT pair lives in cookies that
// JavaScript can read, so an XSS would read the tokens; a strict CSP is the compensating control that makes
// "accept it in P1" acceptable. Pure builder (no Next imports) so it can be unit-tested; `src/proxy.ts`
// calls it once per request with a fresh nonce.
//
//  - `script-src 'self' 'nonce-…' 'strict-dynamic'`: only scripts that carry this request's nonce (Next puts it
//    on its own scripts when the CSP request header is set; `next-themes` gets it as a prop) and the scripts
//    those load. No `'unsafe-inline'`, no `'unsafe-eval'` in production.
//  - `style-src 'self' 'unsafe-inline'`: React inline `style=""` attributes (Radix, sonner, sidebar) cannot
//    carry a nonce; style injection is a far smaller risk than script injection.
//  - `img-src 'self' data: blob: <API origin> <media origins>`: media pictures are served by another origin
//    (`media.staticBaseUrl` of the backend, e.g. the portal in dev, or the file service `file.path_ip`). The backend
//    announces its media origin on the public `GET {API base}/config` (`lib/security/media-origin.ts`, fetched by
//    `src/proxy.ts`, cached); `NEXT_PUBLIC_MEDIA_ORIGINS` (comma separated origins) is an optional extra list and
//    is no longer needed. A picture whose origin is not listed is blocked by the
//    browser and the media screens show their placeholder tile instead.
//  - `media-src 'self' blob: <media origins>`: the `<video>` of the media sheet plays the file from the media origin (the
//    same origins as `img-src`, no API origin); `blob:` is for a local preview of a chosen file before it is uploaded.
//  - `connect-src 'self' <API origin>`: the browser may only call this app and the backend.
//  - `frame-src 'none'`: preview opens in a new tab (decision Q-07-5); add the portal origin when an iframe
//    preview is built.
//  - `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`.

export type CspOptions = {
  nonce: string;
  // `next dev` needs `'unsafe-eval'` (React debugging) and websockets (HMR).
  isDev?: boolean;
  // Origin of the backend (`NEXT_PUBLIC_API_BASE_URL`), when it is not the app's own origin.
  apiOrigin?: string;
  // Origins that serve media pictures (from the backend `/config`, plus the optional `NEXT_PUBLIC_MEDIA_ORIGINS`), allowed in `img-src` only.
  mediaOrigins?: string[];
};

// "http://localhost:3001, https://files.example.com/path" -> ["http://localhost:3001", "https://files.example.com"].
// Only http(s) origins survive; anything else (typos, `*`, `javascript:`) is dropped so the policy can not be
// loosened by a bad value.
export function mediaOriginsFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  const out = new Set<string>();
  for (const part of value.split(",")) {
    const origin = apiOriginFromBaseUrl(part.trim());
    if (origin) out.add(origin);
  }
  return [...out];
}

// "http://localhost:8080/api/v1" -> "http://localhost:8080"; a relative base ("/api/v1"), blank or invalid -> undefined.
export function apiOriginFromBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

// 128 random bits, base64 (a CSP nonce must be unguessable and unique per response).
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildContentSecurityPolicy({ nonce, isDev = false, apiOrigin, mediaOrigins = [] }: CspOptions): string {
  const api = apiOrigin ? ` ${apiOrigin}` : "";
  const media = mediaOrigins.map((o) => ` ${o}`).join("");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${api}${media}`,
    `media-src 'self' blob:${media}`,
    "font-src 'self' data:",
    `connect-src 'self'${api}${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
