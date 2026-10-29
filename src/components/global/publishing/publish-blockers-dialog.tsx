"use client";

import { AlertTriangleIcon, ArrowRightIcon, BanIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { fieldSegments, issueTarget } from "@/components/global/publishing/issue-target";
import { humanizeSegment } from "@/components/global/revisions/snapshot-diff";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PublishableResource } from "@/lib/publishable-resources";
import { cn } from "@/lib/utils";
import type { PublishIssue, PublishIssueTarget } from "@/types/publishing";

type Translator = ReturnType<typeof useTranslations>;

// ICU arguments from `params`: only primitives are valid (arrays and objects are not).
function valuesOf(params: PublishIssue["params"], extra: Record<string, string | number> = {}): Record<string, string | number> {
  const out: Record<string, string | number> = { ...extra };
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return out;
}

// The sentence for one blocker or warning, by its `code` (and `rule` for `template_violation`); the server's `message`
// is the fallback for a code this admin does not know.
export function issueMessage(t: Translator, issue: PublishIssue): string {
  const rule = typeof issue.params?.rule === "string" ? issue.params.rule : undefined;
  const sectionKey = typeof issue.params?.section_key === "string" ? issue.params.section_key : "";
  const section = sectionKey ? (t.has(`sectionTypes.${sectionKey}`) ? t(`sectionTypes.${sectionKey}`) : humanizeSegment(sectionKey)) : "";
  // A slug that is taken says "slug", not "address" (posts: `/translations/<l>/slug`).
  const keys = [rule ? `issues.${issue.code}_${rule}` : "", issue.path.endsWith("/slug") ? `issues.${issue.code}_slug` : "", `issues.${issue.code}`].filter(Boolean);
  for (const key of keys) {
    if (t.has(key)) {
      try {
        return t(key, valuesOf(issue.params, { section, locale: String(issue.params?.locale ?? "") }));
      } catch {
        /* fall through */
      }
    }
  }
  return issue.message || t("issues.unknown", { code: issue.code });
}

export function fieldLabel(t: Translator, issue: PublishIssue): { field: string; locale?: string } {
  return fieldSegments(issue, (segment) => (t.has(`fields.${segment}`) ? t(`fields.${segment}`) : undefined));
}

type Group = { id: string; title: string; items: PublishIssue[] };

// Blockers grouped as the reader thinks of them: the page itself, the structure of the page, then one group per section
// (the engine's order is kept: root, translations, sections by position, template rules).
export function groupIssues(t: Translator, issues: PublishIssue[], resource: PublishableResource = "pages"): Group[] {
  const groups: Group[] = [];
  const add = (id: string, title: string, issue: PublishIssue) => {
    let group = groups.find((g) => g.id === id);
    if (!group) groups.push((group = { id, title, items: [] }));
    group.items.push(issue);
  };
  for (const issue of issues) {
    const target = issueTarget(issue);
    if (target.sectionPublicId) {
      const key = target.sectionKey ?? "";
      const name = key ? (t.has(`sectionTypes.${key}`) ? t(`sectionTypes.${key}`) : humanizeSegment(key)) : t("groups.sectionUnknown");
      const position = target.sectionIndex !== undefined ? target.sectionIndex + 1 : "?";
      add(`s:${target.sectionPublicId}`, t("groups.section", { n: position, name }), issue);
    } else if ((resource === "albums" || resource === "faq-groups") && target.itemPublicId) {
      const position = target.itemIndex !== undefined ? target.itemIndex + 1 : "?";
      add(`i:${target.itemPublicId}`, t(resource === "albums" ? "groups.picture" : "groups.question", { n: position }), issue);
    } else if (resource === "albums" || resource === "faq-groups") {
      add(resource === "albums" ? "album" : "faqGroup", issue.path.startsWith("/items") ? t("groups.items") : t(resource === "albums" ? "groups.album" : "groups.faqGroup"), issue);
    } else if (resource === "forms") add("form", t("groups.form"), issue);
    else if (resource === "posts") add(issue.path.startsWith("/media") ? "gallery" : "post", issue.path.startsWith("/media") ? t("groups.gallery") : t("groups.post"), issue);
    else if (issue.path === "/sections" || issue.path.startsWith("/sections/")) add("structure", t("groups.structure"), issue);
    else add("page", t("groups.page"), issue);
  }
  return groups;
}

// SCR-38 / doc/07 section 2.5.7: the 422 `PUBLISH_BLOCKED` of the publish engine. The blockers (`errors[]`, `in: "entity"`)
// with a "Go to field" link each when the host can take the user there (`onGoToField` gets the pointer and what is known
// about it); the warnings (`details.warnings[]`) do not block and are only listed.
export function PublishBlockersDialog({
  open,
  onOpenChange,
  blockers,
  warnings = [],
  blockerCount,
  truncated = false,
  noun,
  resource = "pages",
  onGoToField,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockers: PublishIssue[];
  warnings?: PublishIssue[];
  // The server's count (can be more than `blockers.length` when truncated).
  blockerCount?: number;
  truncated?: boolean;
  noun: string;
  // Which kind of entity (the groups of the list are named after it).
  resource?: PublishableResource;
  onGoToField?: (target: PublishIssueTarget) => void;
}) {
  const t = useTranslations("publishing.blockers");
  const tp = useTranslations("publishing");
  const groups = useMemo(() => groupIssues(tp, blockers, resource), [tp, blockers, resource]);
  const count = blockerCount ?? blockers.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col md:max-w-2xl" data-testid="publish-blockers">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BanIcon className="size-5 text-destructive" aria-hidden />
            {t("title", { noun })}
          </DialogTitle>
          <DialogDescription>{t("description", { count })}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pe-1">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.title} className="space-y-1.5">
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <ul className="divide-y rounded-md border">
                {group.items.map((issue, i) => {
                  const { field, locale } = fieldLabel(tp, issue);
                  const target = issueTarget(issue);
                  return (
                    <li key={`${issue.path}-${issue.code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="publish-blocker">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium">
                          {field || tp("fields.whole")}
                          {locale ? <span className="ms-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs uppercase">{locale}</span> : null}
                        </p>
                        <p className="text-muted-foreground">{issueMessage(tp, issue)}</p>
                      </div>
                      {onGoToField ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t("goToFieldFor", { field: field || tp("fields.whole") })}
                          onClick={() => {
                            onOpenChange(false);
                            onGoToField(target);
                          }}
                        >
                          {t("goToField")}
                          <ArrowRightIcon className="rtl:rotate-180" aria-hidden />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {truncated || blockers.length < count ? <p className="text-sm text-muted-foreground">{t("truncated", { shown: blockers.length, count })}</p> : null}

          {warnings.length > 0 ? (
            <section aria-label={t("warningsTitle")} className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangleIcon className="size-4 text-amber-600" aria-hidden />
                {t("warningsTitle")}
              </h3>
              <ul className={cn("space-y-1 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100")}>
                {warnings.map((w, i) => {
                  const { field, locale } = fieldLabel(tp, w);
                  return (
                    <li key={`${w.path}-${w.code}-${i}`} data-testid="publish-warning">
                      {field ? <span className="font-medium">{field}{locale ? ` (${locale})` : ""}: </span> : null}
                      {issueMessage(tp, w)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
