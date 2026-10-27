// One-time tokens in e-mailed links travel in the URL FRAGMENT (`/auth/reset-password#token=…`,
// `/auth/accept-invite#token=…`, doc/05 section 10.9.3): a fragment is never sent to the server, nor in a Referer
// header, so it stays out of access logs. The page reads it once on the client and removes it from the address
// bar at once (`history.replaceState`), so it is not left in the history entry, a screenshot or a copied URL.
// The token is held in component state only: never logged, never put in a query key / storage / another URL.

// Extracts `token` from a fragment string (`#token=abc`, `token=abc`). Empty / missing -> null.
export function parseTokenFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get("token");
  return token && token.trim() ? token.trim() : null;
}

// Reads the token from `window.location.hash` and strips the whole fragment from the URL (keeping path + query).
// Browser only (call from an effect, never while rendering).
export function consumeFragmentToken(): string | null {
  const token = parseTokenFragment(window.location.hash);
  if (window.location.hash) {
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch {
      /* ignore: some embedded browsers forbid replaceState */
    }
  }
  return token;
}
