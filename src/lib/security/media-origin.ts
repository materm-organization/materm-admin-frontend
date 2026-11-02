// The backend tells the app which origin serves media pictures: public `GET {API base}/config` answers
// `{"success":true,"data":{"media_origin":"http://localhost:3310"|null}}`. `src/proxy.ts` calls
// `getBackendMediaOrigin()` once per page request to widen `img-src` (and nothing else) of the CSP.
//
// The value goes into a response header, so it is validated strictly (`strictHttpOrigin`) and anything odd is
// ignored. A good answer is cached in module memory for 5 minutes, a failure or invalid answer for 30 seconds, so a
// dead backend costs one <= 1.5 s attempt per 30 s, not one per page.

export const MEDIA_ORIGIN_TTL_MS = 5 * 60_000;
export const MEDIA_ORIGIN_FAILURE_TTL_MS = 30_000;
export const MEDIA_ORIGIN_TIMEOUT_MS = 1_500;

// Returns `url.origin` for a plain http(s) URL, else undefined. Refuses whitespace / control characters, quotes,
// `;` `,` `*` (header or CSP-list injection, wildcards), credentials and non-http(s) schemes.
export function strictHttpOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return undefined;
  if (/[\s\u0000-\u001f\u007f;,*'"<>\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || !url.hostname) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

// `{success:true,data:{media_origin}}` -> validated origin or undefined.
export function mediaOriginFromConfigBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return undefined;
  return strictHttpOrigin((data as { media_origin?: unknown }).media_origin);
}

export function configUrlFromBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl || !strictHttpOrigin(baseUrl)) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/config`;
}

type Cached = { value: string | undefined; expires: number };
let cache: Cached | undefined;
let inflight: Promise<string | undefined> | undefined;

export function resetMediaOriginCache(): void {
  cache = undefined;
  inflight = undefined;
}

async function load(configUrl: string, now: () => number): Promise<string | undefined> {
  let value: string | undefined;
  try {
    const res = await fetch(configUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(MEDIA_ORIGIN_TIMEOUT_MS),
    });
    if (res.ok) value = mediaOriginFromConfigBody(await res.json());
  } catch {
    value = undefined;
  }
  cache = { value, expires: now() + (value ? MEDIA_ORIGIN_TTL_MS : MEDIA_ORIGIN_FAILURE_TTL_MS) };
  return value;
}

export async function getBackendMediaOrigin(
  baseUrl: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
  now: () => number = Date.now,
): Promise<string | undefined> {
  const configUrl = configUrlFromBaseUrl(baseUrl);
  if (!configUrl) return undefined;
  if (cache && cache.expires > now()) return cache.value;
  inflight ??= load(configUrl, now).finally(() => {
    inflight = undefined;
  });
  return inflight;
}
