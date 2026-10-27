// URL rules shared by the link widget, the rich-text link mark and the validator (doc/10 R-016).
//
// The content schemas allow `url` to start with `/` ("internal link"), which also lets `//evil.example/x`
// (protocol-relative: the browser leaves the site) and `/\evil.example` (browsers read `\` as `/`) through.
// The schemas live in doc/ and cannot be fixed here, so the validator replaces the legacy pattern with the
// portable one the backend uses (`LegacyLinkURLPattern` -> `PortableLinkURLPattern` in
// materm-admin-backend/pkg/contentschema/link.go), and this module is the same rule for the widgets.
export const LINK_URL_MAX_LENGTH = 500;

export const LEGACY_LINK_URL_PATTERN = "^(https://|/|mailto:|tel:|#)";
// Works in JavaScript and in Go's RE2 (no lookahead): after the first `/` comes anything but `/` or `\`.
export const PORTABLE_LINK_URL_PATTERN = "^(https://|/([^/\\\\]|$)|mailto:|tel:|#)";

export type LinkUrlKind = "https" | "path" | "mailto" | "tel" | "anchor";

export type LinkUrlCheck =
  | { ok: true; kind: LinkUrlKind }
  | { ok: false; reason: "empty" | "scheme" | "protocol_relative" };

export function checkLinkUrl(raw: string): LinkUrlCheck {
  if (raw.length === 0) return { ok: false, reason: "empty" };
  if (raw.startsWith("//") || raw.startsWith("/\\")) return { ok: false, reason: "protocol_relative" };
  if (raw.startsWith("/")) return { ok: true, kind: "path" };
  if (raw.startsWith("#")) return { ok: true, kind: "anchor" };
  if (raw.startsWith("https://")) return { ok: true, kind: "https" };
  if (raw.startsWith("mailto:")) return { ok: true, kind: "mailto" };
  if (raw.startsWith("tel:")) return { ok: true, kind: "tel" };
  return { ok: false, reason: "scheme" };
}

export function isSafeLinkUrl(raw: string): boolean {
  return checkLinkUrl(raw).ok;
}

// The href of a rich-text link mark (doc/04 section 3.7): the same, but without `#anchors`.
export function isSafeRichLinkHref(raw: string): boolean {
  return !raw.startsWith("#") && isSafeLinkUrl(raw);
}
