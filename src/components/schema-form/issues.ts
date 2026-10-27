import type { ApiFieldError } from "@/types/api";

import { findNodeByPointer, type FieldTree } from "./compile-field-tree";
import { parsePointer, pointerToFieldPath } from "./pointer";
import type { Issue } from "./types";

// Server `errors[]` -> issues of the same shape the client validator produces, and "where does this issue
// live in the form" (doc/07 section 4.6).

// Only body errors address the props; `in: "query" | "path" | "header"` belong to the request, not the form.
// `prefix` lets a caller whose props sit below a body field (`/props/title/la`) strip it.
export function serverErrorsToIssues(errors: ApiFieldError[] | undefined, prefix = ""): Issue[] {
  const issues: Issue[] = [];
  for (const error of errors ?? []) {
    if (error.in !== "body") continue;
    let path = error.path;
    if (prefix) {
      if (path === prefix) path = "";
      else if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
      else continue;
    }
    if (path !== "" && !path.startsWith("/")) continue;
    issues.push({ path, code: error.code, params: error.params, message: error.message, keyword: "server" });
  }
  return issues;
}

export type IssueLocation = {
  // Pointer of the field (a locale map's pointer, without the locale).
  fieldPointer: string;
  // The same as a dotted form path (`items.1.title`, doc/07 section 4.6; `pointerToFieldPath`), for "go to field".
  fieldPath?: string;
  // Locale the issue belongs to (a segment under an `x-localized` node, or the alt locale of an image).
  locale?: string;
  // Pointers of the array items on the way (to expand them).
  itemPointers: string[];
  // false: no field of the tree matches (a section-level error such as `/variant`).
  matched: boolean;
};

export function locateIssue(tree: FieldTree, pointer: string): IssueLocation {
  const segments = parsePointer(pointer);
  const found = findNodeByPointer(tree, segments);
  if (!found) return { fieldPointer: pointer, fieldPath: pointerToFieldPath(pointer), itemPointers: [], matched: false };
  const { node, locale, itemIndexes } = found;
  let fieldPointer = pointer;
  if (locale && (node.kind === "localized-text" || node.kind === "richtext" || node.kind === "image")) {
    // `/title/la` -> the map `/title`; `/background/alt/la` -> `/background/alt`.
    fieldPointer = pointer.slice(0, pointer.lastIndexOf("/"));
  }
  return { fieldPointer, fieldPath: pointerToFieldPath(fieldPointer), locale, itemPointers: itemIndexes.map((i) => i.pointer), matched: true };
}

// Number of issues per locale (the badge of the locale switcher) and how many have no locale.
export function countIssuesByLocale(tree: FieldTree, issues: Issue[]): { byLocale: Record<string, number>; other: number } {
  const byLocale: Record<string, number> = {};
  let other = 0;
  for (const issue of issues) {
    const { locale } = locateIssue(tree, issue.path);
    if (locale) byLocale[locale] = (byLocale[locale] ?? 0) + 1;
    else other += 1;
  }
  return { byLocale, other };
}

export function groupIssuesByPointer(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = map.get(issue.path);
    if (list) list.push(issue);
    else map.set(issue.path, [issue]);
  }
  return map;
}
