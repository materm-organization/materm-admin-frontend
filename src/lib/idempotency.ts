// `Idempotency-Key` (doc/05 section 1.13, doc/07 section 2.5.10). A side-effecting POST (create user, reset
// password, create role, API key, cms creates) sends one UUIDv4 generated ONCE per dialog open, so a
// double click or a retry after a lost response reuses the same key. The backend ignores the header in P0
// (safe to send); a replay (`Idempotent-Replayed: true`) that no longer carries a secret is shown by
// `OneTimeSecretDialog` as "already shown".
import type { AxiosRequestConfig } from "axios";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Insecure-context fallback (plain-http LAN address): RFC 4122 v4 from getRandomValues / Math.random.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The header as a plain record, to COMBINE with other headers (`{ ...ifMatchHeaders(e), ...idempotencyKeyHeaders(k) }`).
export function idempotencyKeyHeaders(key: string | null | undefined): Record<string, string> {
  return key ? { [IDEMPOTENCY_KEY_HEADER]: key } : {};
}

// The same as an axios request config, when it is the only extra header.
export function idempotencyHeaders(key: string | null | undefined): Pick<AxiosRequestConfig, "headers"> {
  return key ? { headers: idempotencyKeyHeaders(key) } : {};
}
