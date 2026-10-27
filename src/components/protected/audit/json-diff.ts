// A tiny structural diff of two audit snapshots (`before` / `after`), used by the audit detail drawer
// (doc/07 section 3.6 "DiffViewer, JSON mode"). It lists the LEAVES that were added, removed or changed with a
// dotted path (`grants.cms.blog[1]`). No dependency: snapshots are small, secret-free JSON.

export type DiffKind = "added" | "removed" | "changed";
export type DiffRow = { path: string; kind: DiffKind; before?: unknown; after?: unknown };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function join(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function leaves(value: unknown, path: string, kind: "added" | "removed", out: DiffRow[]) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && path) out.push(kind === "added" ? { path, kind, after: {} } : { path, kind, before: {} });
    for (const key of keys.sort()) leaves(value[key], join(path, key), kind, out);
    return;
  }
  // Arrays of scalars are one leaf (an action list reads better whole); arrays of objects go item by item.
  if (Array.isArray(value) && value.some((item) => typeof item === "object" && item !== null)) {
    value.forEach((item, i) => leaves(item, join(path, i), kind, out));
    return;
  }
  out.push(kind === "added" ? { path, kind, after: value } : { path, kind, before: value });
}

function walk(before: unknown, after: unknown, path: string, out: DiffRow[]) {
  if (before === undefined && after === undefined) return;
  if (before === undefined) return leaves(after, path, "added", out);
  if (after === undefined) return leaves(before, path, "removed", out);
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()) {
      walk(before[key], after[key], join(path, key), out);
    }
    return;
  }
  const objectArrays =
    Array.isArray(before) &&
    Array.isArray(after) &&
    [...before, ...after].some((item) => typeof item === "object" && item !== null);
  if (objectArrays) {
    const length = Math.max((before as unknown[]).length, (after as unknown[]).length);
    for (let i = 0; i < length; i++) walk((before as unknown[])[i], (after as unknown[])[i], join(path, i), out);
    return;
  }
  if (!same(before, after)) out.push({ path, kind: "changed", before, after });
}

// `null` / missing snapshot = nothing on that side (a create has no `before`, a delete no `after`).
export function diffJson(before: unknown, after: unknown): DiffRow[] {
  const out: DiffRow[] = [];
  walk(before ?? undefined, after ?? undefined, "", out);
  return out;
}

// Short text for a value cell.
export function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const text = JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}
