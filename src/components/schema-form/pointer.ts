// JSON Pointer (RFC 6901) helpers for the form engine. Parsing / the dotted form-path come from
// `lib/form-errors.ts` (shared with the fixed forms); this adds building a pointer and reading a value by one.
import { parsePointer } from "@/lib/form-errors";

export { parsePointer, pointerToFieldPath } from "@/lib/form-errors";

export function escapePointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function joinPointer(parent: string, segment: string | number): string {
  return `${parent}/${escapePointerSegment(segment)}`;
}

export function pointerFromSegments(segments: Array<string | number>): string {
  return segments.map((s) => `/${escapePointerSegment(s)}`).join("");
}

// Value at a pointer, `undefined` when any step is missing.
export function getByPointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  let node: unknown = root;
  for (const segment of parsePointer(pointer)) {
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      node = node[index];
    } else if (node !== null && typeof node === "object") {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return node;
}

// Immutable write: arrays and objects along the path are copied, everything else keeps its identity (so
// memoised widgets of untouched branches do not re-render). `undefined` deletes the key (or the array slot is
// not allowed to be undefined - arrays are edited with the array helpers below).
export function setByPointer<T>(root: T, pointer: string, value: unknown): T {
  return setIn(root, parsePointer(pointer), value) as T;
}

export function setIn(node: unknown, segments: string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  // A missing container below a numeric step is an array (`/images/2` when `images` does not exist yet).
  if ((node === undefined || node === null) && /^\d+$/.test(head)) node = [];
  if (Array.isArray(node)) {
    const index = Number(head);
    const copy = node.slice();
    // Writing past the end (the slots of a fixed-size array that shows more slots than it stores) fills the gap
    // with empty objects instead of leaving holes, which JSON would turn into `null`.
    while (copy.length < index) copy.push({});
    copy[index] = setIn(node[index], rest, value);
    return copy;
  }
  const base = node !== null && typeof node === "object" ? (node as Record<string, unknown>) : {};
  if (rest.length === 0 && value === undefined) {
    if (!(head in base)) return base;
    const { [head]: removed, ...others } = base;
    void removed;
    return others;
  }
  return { ...base, [head]: setIn(base[head], rest, value) };
}

// Pointer segments of a form position: `["items", 1, "title"]` -> "/items/1/title"; the inverse is `parsePointer`.
export function isDescendantOrSelf(pointer: string, ancestor: string): boolean {
  return ancestor === "" || pointer === ancestor || pointer.startsWith(`${ancestor}/`);
}
