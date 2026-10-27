// Pure logic of the role permission matrix (SCR-10; doc/05 section 3.2.6, doc/07 section 3.5). No React.
//
// A matrix is `{ permission_key: actions[] }` for ALL keys of the catalog (an empty array = no access).
// Rules the UI enforces (the server re-checks every one of them):
//  - BR-23: an action must be in the key's `available_actions` (other cells do not exist);
//  - BR-22: any action needs `read`. In the UI the other cells of a row are DISABLED until `read` is ticked, and
//    unticking `read` clears the row. Bulk switches (row / category / column) add `read` themselves.
import type { GrantChange, GrantInput, RolePermission } from "@/types/iam";

export type Matrix = Record<string, string[]>;
export const READ = "read";

// Column groups of the 15 actions (header captions only; order is the order of GET /permissions.actions).
export const ACTION_GROUPS: { id: string; actions: string[] }[] = [
  { id: "basic", actions: ["read", "create", "update", "update_own", "delete", "delete_own"] },
  { id: "publishing", actions: ["publish", "unpublish", "schedule", "review"] },
  { id: "other", actions: ["translate", "export", "import", "manage_schema", "execute"] },
];

// Fallback order if the catalog has not loaded: the 15 actions in the documented order.
export const DEFAULT_ACTION_ORDER = ACTION_GROUPS.flatMap((g) => g.actions);

// Dedupe, keep only available actions, in the catalog's column order.
export function canonicalize(actions: readonly string[], available: readonly string[], order: readonly string[]): string[] {
  const wanted = new Set(actions);
  return order.filter((action) => wanted.has(action) && available.includes(action));
}

export function matrixFromPermissions(permissions: readonly RolePermission[], order: readonly string[]): Matrix {
  const matrix: Matrix = {};
  for (const p of permissions) matrix[p.permission_key] = canonicalize(p.actions, p.available_actions, order);
  return matrix;
}

export type RowState = "none" | "partial" | "full";

export function rowState(actions: readonly string[], available: readonly string[]): RowState {
  if (actions.length === 0) return "none";
  return available.every((a) => actions.includes(a)) ? "full" : "partial";
}

// A single cell. `read` toggles the row on/off (off clears everything); any other cell needs `read` first
// (a click on a locked cell does nothing).
export function toggleAction(
  row: readonly string[],
  action: string,
  available: readonly string[],
  order: readonly string[]
): string[] {
  if (!available.includes(action)) return canonicalize(row, available, order);
  if (action === READ) {
    return row.includes(READ) ? [] : canonicalize([...row, READ], available, order);
  }
  if (!row.includes(READ)) return canonicalize(row, available, order);
  const next = row.includes(action) ? row.filter((a) => a !== action) : [...row, action];
  return canonicalize(next, available, order);
}

export function fullRow(available: readonly string[], order: readonly string[]): string[] {
  return canonicalize(available, available, order);
}

// Switch of a row: full access <-> none.
export function toggleRowFull(row: readonly string[], available: readonly string[], order: readonly string[]): string[] {
  return rowState(row, available) === "full" ? [] : fullRow(available, order);
}

// Switch of a category (a group of rows): all rows full unless they already are, then all none.
export function toggleCategoryFull(
  matrix: Matrix,
  permissions: readonly RolePermission[],
  order: readonly string[]
): Matrix {
  const allFull = permissions.every((p) => rowState(matrix[p.permission_key] ?? [], p.available_actions) === "full");
  const next: Matrix = { ...matrix };
  for (const p of permissions) next[p.permission_key] = allFull ? [] : fullRow(p.available_actions, order);
  return next;
}

export type ColumnState = "none" | "some" | "all" | "unavailable";

export function columnState(matrix: Matrix, permissions: readonly RolePermission[], action: string): ColumnState {
  const rows = permissions.filter((p) => p.available_actions.includes(action));
  if (rows.length === 0) return "unavailable";
  const have = rows.filter((p) => (matrix[p.permission_key] ?? []).includes(action)).length;
  return have === 0 ? "none" : have === rows.length ? "all" : "some";
}

// Header checkbox of a column: add the action on every row that has it (plus `read` there), or remove it
// everywhere when it is already on all rows. For `read` removal clears those rows.
export function toggleColumn(
  matrix: Matrix,
  permissions: readonly RolePermission[],
  action: string,
  order: readonly string[]
): Matrix {
  const rows = permissions.filter((p) => p.available_actions.includes(action));
  if (rows.length === 0) return matrix;
  const removing = columnState(matrix, permissions, action) === "all";
  const next: Matrix = { ...matrix };
  for (const p of rows) {
    const row = matrix[p.permission_key] ?? [];
    if (removing) {
      next[p.permission_key] = action === READ ? [] : canonicalize(row.filter((a) => a !== action), p.available_actions, order);
    } else {
      next[p.permission_key] = canonicalize([...row, READ, action], p.available_actions, order);
    }
  }
  return next;
}

// --- presets -----------------------------------------------------------------------------------------------

export function nonePreset(permissions: readonly RolePermission[]): Matrix {
  return Object.fromEntries(permissions.map((p) => [p.permission_key, [] as string[]]));
}

export function readOnlyPreset(permissions: readonly RolePermission[], order: readonly string[]): Matrix {
  return Object.fromEntries(
    permissions.map((p) => [p.permission_key, canonicalize([READ], p.available_actions, order)])
  );
}

export function fullPreset(permissions: readonly RolePermission[], order: readonly string[]): Matrix {
  return Object.fromEntries(permissions.map((p) => [p.permission_key, fullRow(p.available_actions, order)]));
}

// "Copy from role X": the grants of another role, re-fitted to THIS catalog's available actions.
export function copyPreset(
  source: readonly RolePermission[],
  permissions: readonly RolePermission[],
  order: readonly string[]
): Matrix {
  const bySource = new Map(source.map((p) => [p.permission_key, p.actions]));
  return Object.fromEntries(
    permissions.map((p) => [p.permission_key, canonicalize(bySource.get(p.permission_key) ?? [], p.available_actions, order)])
  );
}

// --- diff / save body --------------------------------------------------------------------------------------

export function sameActions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

// Keys whose actions differ between the saved matrix and the draft (catalog order), with before/after.
export function diffMatrix(base: Matrix, draft: Matrix, permissions: readonly RolePermission[]): GrantChange[] {
  const changes: GrantChange[] = [];
  for (const p of permissions) {
    const before = base[p.permission_key] ?? [];
    const after = draft[p.permission_key] ?? [];
    if (!sameActions(before, after)) changes.push({ permission_key: p.permission_key, before, after });
  }
  return changes;
}

export type DiffSummary = { added: number; removed: number; keys: number; categories: number };

// "+3 / -1 permissions in 2 keys": counts single (key, action) grants gained and lost.
export function summarizeDiff(changes: readonly GrantChange[], permissions: readonly RolePermission[]): DiffSummary {
  let added = 0;
  let removed = 0;
  const categories = new Set<string>();
  for (const change of changes) {
    added += change.after.filter((a) => !change.before.includes(a)).length;
    removed += change.before.filter((a) => !change.after.includes(a)).length;
    const category = permissions.find((p) => p.permission_key === change.permission_key)?.category;
    if (category) categories.add(category);
  }
  return { added, removed, keys: changes.length, categories: categories.size };
}

// Body of PUT /roles/{id}/permissions: ONLY rows with actions (a key left out loses its actions). The array
// index of a row here is the `n` of server errors `/grants/{n}/…` — see `grantIndexToKey`.
export function toGrants(draft: Matrix, permissions: readonly RolePermission[], order: readonly string[]): GrantInput[] {
  const grants: GrantInput[] = [];
  for (const p of permissions) {
    const actions = canonicalize(draft[p.permission_key] ?? [], p.available_actions, order);
    if (actions.length > 0) grants.push({ permission_key: p.permission_key, actions });
  }
  return grants;
}

// Server error pointer `/grants/3/actions/1` -> the permission key of grants[3] of the body that was sent.
export function grantPointerToKey(path: string, grants: readonly GrantInput[]): string | undefined {
  const match = /^\/grants\/(\d+)(?:\/|$)/.exec(path);
  if (!match) return undefined;
  return grants[Number(match[1])]?.permission_key;
}

// Rows grouped by `category`, first-seen order (the catalog is sorted by sort_order).
export function groupByCategory(permissions: readonly RolePermission[]): { category: string; permissions: RolePermission[] }[] {
  const groups: { category: string; permissions: RolePermission[] }[] = [];
  for (const p of permissions) {
    let group = groups.find((g) => g.category === p.category);
    if (!group) {
      group = { category: p.category, permissions: [] };
      groups.push(group);
    }
    group.permissions.push(p);
  }
  return groups;
}
