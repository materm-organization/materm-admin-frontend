import { humanizeSegment, pointerToSegments, splitLocale } from "@/components/global/revisions/snapshot-diff";
import type { PublishIssue, PublishIssueTarget } from "@/types/publishing";

const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What "Go to field" hands to the host: the pointer as the server wrote it plus what can be read from it
// (doc/05 12.7.2: a section's segment is its `public_id`; `params` carry `section_id` / `section_key` / `section_index`).
export function issueTarget(issue: PublishIssue): PublishIssueTarget {
  const segments = pointerToSegments(issue.path);
  const params = issue.params ?? {};
  const sectionPublicId = segments[0] === "sections" && segments[1] && UUID.test(segments[1]) ? segments[1] : undefined;
  const last = segments[segments.length - 1];
  // `.../title/la` and `/translations/la/seo_title`: the language is a map key.
  const locale =
    typeof params.locale === "string"
      ? params.locale
      : splitLocale(segments).locale ?? (segments.length > 1 && last && LOCALE.test(last) && segments[segments.length - 2] !== "sections" ? last : undefined);
  return {
    pointer: issue.path,
    code: issue.code,
    locale,
    sectionId: typeof params.section_id === "number" ? params.section_id : undefined,
    sectionKey: typeof params.section_key === "string" ? params.section_key : undefined,
    sectionIndex: typeof params.section_index === "number" ? params.section_index : undefined,
    sectionPublicId,
    // T1.5.6: a blocker inside a picture of an album / a question of a FAQ group (`/items/<public_id>/...`).
    itemId: typeof params.item_id === "number" ? params.item_id : undefined,
    itemIndex: typeof params.item_index === "number" ? params.item_index : undefined,
    itemPublicId: segments[0] === "items" && segments[1] && UUID.test(segments[1]) ? segments[1] : undefined,
  };
}

// The path a reader sees as a field name: the segments after `/sections/<id>/props`, `/translations/<l>`, ... as
// words, the language removed (it is shown next to it). `labelOf(segment)` gives the translated word or `undefined`.
export function fieldSegments(issue: PublishIssue, labelOf: (segment: string) => string | undefined): { field: string; locale?: string } {
  const all = pointerToSegments(issue.path);
  const target = issueTarget(issue);
  let rest = all;
  if (all[0] === "sections" && all[1]) rest = all.slice(2);
  if (rest[0] === "props") rest = rest.slice(1);
  // `/items/<public_id>/media_id` (album) and `/items/<public_id>/translations/la/answer` (FAQ): the uuid is not a field name.
  if (rest[0] === "items" && rest[1] && UUID.test(rest[1])) rest = rest.slice(2);
  if (rest[0] === "translations") rest = rest.slice(1);
  // Forms: `/field_translations/<field key>/<language>/<member>` reads "<field key> > <member>" (the language is shown next to it).
  if (rest[0] === "field_translations" && rest.length >= 4) rest = [rest[1], ...rest.slice(3)];
  // drop the language (a map key) wherever it stands
  const kept = rest.filter((s, i) => !(target.locale && s === target.locale && (i === rest.length - 1 || rest[i - 1] === undefined)));
  // `/media/<row id>/media_id` (a post's gallery): the row id is not a position, so it is not shown.
  const words = kept
    .filter((s, i) => !(/^\d+$/.test(s) && kept[i - 1] === "media"))
    .map((s) => (/^\d+$/.test(s) ? `#${Number(s) + 1}` : (labelOf(s) ?? humanizeSegment(s))))
    .filter(Boolean);
  return { field: words.join(" › "), locale: target.locale };
}
