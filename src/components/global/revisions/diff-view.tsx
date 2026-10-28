"use client";

import { diffWordsWithSpace } from "diff";
import { useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";

import { useLocales } from "@/hooks/use-locales";
import { cn } from "@/lib/utils";
import {
  diffSnapshots,
  flattenSnapshot,
  humanizeSegment,
  rowPosition,
  splitLocale,
  type Change,
  type Leaf,
} from "./snapshot-diff";

type Translator = ReturnType<typeof useTranslations>;

// Readable names for the languages of a snapshot: "Lao (la)". Falls back to the code.
function useLocaleName() {
  const { data } = useLocales();
  const rows = data?.data;
  return useMemo(() => {
    const names = new Map((rows ?? []).map((l) => [l.code, l.name]));
    return {
      codes: (rows ?? []).map((l) => l.code),
      name: (code: string) => (names.has(code) ? `${names.get(code)} (${code})` : code.toUpperCase()),
    };
  }, [rows]);
}

// `items` > `#2` > `label`: field names come from `revisions.fields.<name>` (humanized when unknown), a row of an
// identity-keyed list is "#<position>" (never the uuid), a number index is "#<n+1>".
function useSegmentLabel() {
  const t = useTranslations("revisions");
  return (segments: string[], index: number, positions: Record<string, number>): string => {
    const seg = segments[index];
    const position = rowPosition(positions, segments, index);
    if (position !== undefined) return t("row", { n: position });
    if (/^\d+$/.test(seg) && index > 0) return t("row", { n: Number(seg) + 1 });
    return t.has(`fields.${seg}`) ? t(`fields.${seg}`) : humanizeSegment(seg);
  };
}

function formatLeaf(t: Translator, value: Leaf | undefined): { text: string; empty: boolean } {
  if (value === undefined || value === null) return { text: t("value.none"), empty: true };
  if (value === "") return { text: t("value.emptyText"), empty: true };
  if (value === "[]") return { text: t("value.emptyList"), empty: true };
  if (typeof value === "boolean") return { text: value ? t("value.yes") : t("value.no"), empty: false };
  return { text: String(value), empty: false };
}

function Value({ value, tone }: { value: Leaf | undefined; tone?: "old" | "new" }) {
  const t = useTranslations("revisions");
  const { text, empty } = formatLeaf(t, value);
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 break-words whitespace-pre-wrap",
        empty && "italic text-muted-foreground",
        tone === "old" && "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
        tone === "new" && "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
      )}
    >
      {text}
    </span>
  );
}

// Two strings word by word: removed words struck through in red, added ones in green (`diffWordsWithSpace`).
function WordDiff({ before, after }: { before: string; after: string }) {
  const t = useTranslations("revisions");
  const parts = useMemo(() => diffWordsWithSpace(before, after), [before, after]);
  return (
    <span className="break-words whitespace-pre-wrap" aria-label={t("wordDiff")}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.added ? (
            <ins className="rounded bg-green-100 text-green-900 no-underline dark:bg-green-950 dark:text-green-200">{part.value}</ins>
          ) : part.removed ? (
            <del className="rounded bg-red-100 text-red-900 line-through dark:bg-red-950 dark:text-red-200">{part.value}</del>
          ) : (
            part.value
          )}
        </Fragment>
      ))}
    </span>
  );
}

function ChangeRow({ change, label }: { change: Change; label: string }) {
  const t = useTranslations("revisions");
  const bothText = typeof change.before === "string" && typeof change.after === "string" && change.before !== "" && change.after !== "";
  return (
    <li className="space-y-1 px-3 py-2 text-sm" data-op={change.op}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "rounded border px-1.5 text-[11px] uppercase tracking-wide",
            change.op === "added" && "border-green-600 text-green-700 dark:text-green-400",
            change.op === "removed" && "border-red-600 text-red-700 dark:text-red-400",
            change.op === "changed" && "border-amber-600 text-amber-700 dark:text-amber-400"
          )}
        >
          {t(`op.${change.op}`)}
        </span>
      </div>
      {change.op === "changed" && bothText ? (
        <WordDiff before={change.before as string} after={change.after as string} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {change.op !== "added" ? <Value value={change.before} tone="old" /> : null}
          {change.op === "changed" ? <span aria-hidden>→</span> : null}
          {change.op !== "removed" ? <Value value={change.after} tone="new" /> : null}
        </div>
      )}
    </li>
  );
}

type Group = { key: string; locale?: string; rows: Array<{ change: Change; label: string }> };

// SCR-37 "compare" (doc/07 section 3.23): the fields that differ between two snapshots, old -> new, grouped by
// language ("General", then one block per language). Paths are shown as field names, never as JSON pointers; text
// changes are word-level.
export function DiffView({ before, after, className }: { before: unknown; after: unknown; className?: string }) {
  const t = useTranslations("revisions");
  const localeName = useLocaleName();
  const segmentLabel = useSegmentLabel();
  const { changes, positions } = useMemo(() => diffSnapshots(before, after), [before, after]);

  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const change of changes) {
      const { locale, segments } = splitLocale(change.segments, localeName.codes);
      const label = segments.map((_, i) => segmentLabel(segments, i, positions)).join(" › ");
      const key = locale ?? "";
      let group = out.find((g) => g.key === key);
      if (!group) {
        group = { key, locale, rows: [] };
        out.push(group);
      }
      group.rows.push({ change, label: label || t("whole") });
    }
    // "General" first, languages after (in the order they first changed).
    return out.sort((x, y) => Number(Boolean(x.locale)) - Number(Boolean(y.locale)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes, positions, localeName.codes]);

  if (changes.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{t("noDifferences")}</p>;
  }
  return (
    <div className={cn("space-y-3", className)} data-testid="diff-view">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t("differences", { count: changes.length })}
      </p>
      {groups.map((group) => (
        <section key={group.key || "general"} aria-label={group.locale ? localeName.name(group.locale) : t("general")}>
          <h4 className="mb-1 text-sm font-semibold">{group.locale ? localeName.name(group.locale) : t("general")}</h4>
          <ul className="divide-y rounded-md border">
            {group.rows.map(({ change, label }) => (
              <ChangeRow key={change.pointer} change={change} label={label} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// A snapshot as a read-only list of fields (doc/07 section 3.23: "a form, not raw JSON"): the same labels and
// language grouping as the diff.
export function SnapshotView({ snapshot, className }: { snapshot: unknown; className?: string }) {
  const t = useTranslations("revisions");
  const localeName = useLocaleName();
  const segmentLabel = useSegmentLabel();
  const { leaves, positions } = useMemo(() => flattenSnapshot(snapshot), [snapshot]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; locale?: string; rows: Array<{ pointer: string; label: string; value: Leaf }> }> = [];
    for (const leaf of leaves) {
      const { locale, segments } = splitLocale(leaf.segments, localeName.codes);
      const label = segments.map((_, i) => segmentLabel(segments, i, positions)).join(" › ");
      const key = locale ?? "";
      let group = out.find((g) => g.key === key);
      if (!group) {
        group = { key, locale, rows: [] };
        out.push(group);
      }
      group.rows.push({ pointer: leaf.pointer, label: label || t("whole"), value: leaf.value });
    }
    return out.sort((x, y) => Number(Boolean(x.locale)) - Number(Boolean(y.locale)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaves, positions, localeName.codes]);

  if (leaves.length === 0) return <p className="text-sm text-muted-foreground">{t("emptySnapshot")}</p>;
  return (
    <div className={cn("space-y-3", className)} data-testid="snapshot-view">
      {groups.map((group) => (
        <section key={group.key || "general"} aria-label={group.locale ? localeName.name(group.locale) : t("general")}>
          <h4 className="mb-1 text-sm font-semibold">{group.locale ? localeName.name(group.locale) : t("general")}</h4>
          <dl className="divide-y rounded-md border text-sm">
            {group.rows.map((row) => (
              <div key={row.pointer} className="grid gap-1 px-3 py-2 sm:grid-cols-[14rem_1fr]">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd>
                  <Value value={row.value} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
