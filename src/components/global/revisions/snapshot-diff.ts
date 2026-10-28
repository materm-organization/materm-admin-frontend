// Pure helpers behind `DiffView` / `SnapshotView` (doc/07 section 3.23, doc/05 section 11.7 item 3): a revision's
// `snapshot` is an arbitrary JSON object whose shape depends on the entity (menu items, settings, translations ...).
// The generic UI turns it into LEAVES addressed by JSON Pointer; arrays of rows that carry an identity
// (`locale_code`, `public_id`, `key`, `id`) are keyed by it, so adding a language or moving an item is not a diff of
// every row after it.

export type Leaf = string | number | boolean | null;

export type FlatLeaf = {
  // RFC 6901 pointer with identity-keyed arrays: `/translations/la/alt`.
  pointer: string;
  // Unescaped path segments.
  segments: string[];
  value: Leaf;
};

export type Change = {
  pointer: string;
  segments: string[];
  op: "added" | "removed" | "changed";
  before?: Leaf;
  after?: Leaf;
};

const IDENTITY_KEYS = ["locale_code", "public_id", "key", "id"] as const;

const escapeSegment = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The identity key all rows of an array share (and whose values are unique), if any.
function identityKey(rows: unknown[]): (typeof IDENTITY_KEYS)[number] | null {
  if (rows.length === 0 || !rows.every(isPlainObject)) return null;
  for (const key of IDENTITY_KEYS) {
    const values = rows.map((r) => (r as Record<string, unknown>)[key]);
    if (values.every((v) => (typeof v === "string" && v !== "") || typeof v === "number") && new Set(values).size === values.length) {
      return key;
    }
  }
  return null;
}

export type FlattenResult = {
  leaves: FlatLeaf[];
  // For identity-keyed array rows: pointer of the row -> its 1-based position (so the UI can say "item 2").
  positions: Record<string, number>;
};

export function flattenSnapshot(snapshot: unknown): FlattenResult {
  const leaves: FlatLeaf[] = [];
  const positions: Record<string, number> = {};

  const walk = (value: unknown, pointer: string, segments: string[]) => {
    if (Array.isArray(value)) {
      const key = identityKey(value);
      value.forEach((item, index) => {
        if (key) {
          const id = String((item as Record<string, unknown>)[key]);
          const childPointer = `${pointer}/${escapeSegment(id)}`;
          positions[childPointer] = index + 1;
          walk(item, childPointer, [...segments, id]);
        } else {
          walk(item, `${pointer}/${index}`, [...segments, String(index)]);
        }
      });
      if (value.length === 0) leaves.push({ pointer, segments, value: "[]" });
      return;
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      for (const [k, v] of entries) walk(v, `${pointer}/${escapeSegment(k)}`, [...segments, k]);
      return;
    }
    leaves.push({ pointer, segments, value: (value === undefined ? null : value) as Leaf });
  };

  walk(snapshot, "", []);
  return { leaves, positions };
}

// What changed going from `before` to `after`. Order: the order of `after`, then what only `before` had.
export function diffSnapshots(before: unknown, after: unknown): { changes: Change[]; positions: Record<string, number> } {
  const a = flattenSnapshot(before);
  const b = flattenSnapshot(after);
  const aMap = new Map(a.leaves.map((l) => [l.pointer, l]));
  const bMap = new Map(b.leaves.map((l) => [l.pointer, l]));
  const changes: Change[] = [];
  for (const leaf of b.leaves) {
    const old = aMap.get(leaf.pointer);
    if (!old) changes.push({ pointer: leaf.pointer, segments: leaf.segments, op: "added", after: leaf.value });
    else if (old.value !== leaf.value) {
      changes.push({ pointer: leaf.pointer, segments: leaf.segments, op: "changed", before: old.value, after: leaf.value });
    }
  }
  for (const leaf of a.leaves) {
    if (!bMap.has(leaf.pointer)) changes.push({ pointer: leaf.pointer, segments: leaf.segments, op: "removed", before: leaf.value });
  }
  return { changes, positions: { ...a.positions, ...b.positions } };
}

// Segments that name a map of languages: `/translations/<code>/...`, `/values/<code>`, `/notes/<code>`.
const LOCALE_MAP_SEGMENTS = new Set(["translations", "values", "notes"]);

export type PathParts = {
  // Language code when the path is inside a per-language branch.
  locale?: string;
  // The remaining segments, language removed (e.g. `["items", "0192...", "label"]`).
  segments: string[];
};

export function splitLocale(segments: string[], knownLocales: readonly string[] = []): PathParts {
  for (let i = 1; i < segments.length; i++) {
    const parent = segments[i - 1];
    const seg = segments[i];
    const looksLikeLocale = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(seg) || knownLocales.includes(seg);
    if (LOCALE_MAP_SEGMENTS.has(parent) && looksLikeLocale) {
      // `/translations/<code>/alt` -> `alt` (the map name carries no information); `/values/<code>` keeps `values`.
      const dropParent = parent === "translations" ? 1 : 0;
      return { locale: seg, segments: [...segments.slice(0, i - dropParent), ...segments.slice(i + 1)] };
    }
  }
  return { segments };
}

// "snake_case_name" -> "Snake case name" (the fallback when a field has no label).
export function humanizeSegment(segment: string): string {
  const spaced = segment.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : segment;
}

// Position of the row at `pointerPrefix` (1-based), when the row is an identity-keyed array element.
export function rowPosition(positions: Record<string, number>, segments: string[], index: number): number | undefined {
  const prefix = "/" + segments.slice(0, index + 1).map(escapeSegment).join("/");
  return positions[prefix];
}

// A pointer from a server error (`/items/2/page_id`, `/asset/folder_id`) as segments.
export function pointerToSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}
