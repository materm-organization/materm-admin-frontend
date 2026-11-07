"use client";

import { AlertTriangleIcon, CheckIcon, EyeIcon, EyeOffIcon, Link2Icon, MoreHorizontalIcon, PlusIcon, Trash2Icon, UnlinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { SortableList } from "@/components/global/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/locales";
import type { PageTemplate, SectionSummary } from "@/types/pages";

import { sectionExcerpt } from "./section-excerpt";
import { orderProblem, requirementStates } from "./section-structure";

export type SectionListProps = {
  sections: SectionSummary[];
  template?: PageTemplate;
  // Active languages and the one being edited.
  locales: Locale[];
  locale: string;
  defaultLocale: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  // The page is in the trash: nothing can be changed.
  readOnly?: boolean;
  // Server problems of the last failed save, per section id; the section whose form has unsaved edits.
  issueCounts: Record<number, number>;
  dirtyId: number | null;
  onAdd: (position: number) => void;
  onToggleVisible: (section: SectionSummary) => void | Promise<void>;
  onDelete: (section: SectionSummary) => void;
  // `⋯ -> Detach to a copy` of a section that references a shared section (05 18.10); needs `cms.sections:update`.
  onDetach?: (section: SectionSummary) => void;
  // Sends the whole new order (`PUT .../sections/order`, right after the drop: 07 SCR-20). Rejects when refused.
  onReorder: (ids: number[]) => Promise<unknown>;
};

// SectionList of SCR-20 (doc/07 section 3.12): order, type + a short text, visible / hidden, the languages that still
// miss texts, problems of the last save. Drag, keyboard (handle) or the up / down buttons reorder; a drop is sent at once.
export function SectionList({
  sections,
  template,
  locales,
  locale,
  defaultLocale,
  selectedId,
  onSelect,
  canCreate,
  canUpdate,
  canDelete,
  readOnly = false,
  issueCounts,
  dirtyId,
  onAdd,
  onToggleVisible,
  onDelete,
  onDetach,
  onReorder,
}: SectionListProps) {
  const t = useTranslations("pages.editor.sections");
  const tTypes = useTranslations("publishing.sectionTypes");
  // The order shown while a `PUT` is in flight (the list jumps at the drop, then the answer confirms it).
  const [pending, setPending] = useState<number[] | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const byId = new Map(sections.map((s) => [s.id, s]));
  const shown = pending ? pending.map((id) => byId.get(id)).filter((s): s is SectionSummary => Boolean(s)) : sections;
  const mutable = !readOnly && canUpdate;
  const requirements = requirementStates(template, sections);

  const typeName = (s: SectionSummary) => (tTypes.has(s.section_type.key) ? tTypes(s.section_type.key) : s.section_type.name);

  const move = async (from: number, to: number) => {
    const next = shown.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    const problem = orderProblem(template, next.map((s) => s.section_type.key));
    if (problem) {
      toast.error(t(`reorderRefused.${problem}`));
      return;
    }
    const ids = next.map((s) => s.id);
    setPending(ids);
    try {
      await onReorder(ids);
    } catch {
      // the caller says why; the old order comes back
    } finally {
      setPending(null);
    }
  };

  const toggle = async (section: SectionSummary) => {
    setToggling(section.id);
    try {
      await onToggleVisible(section);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="section-list">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("title", { count: sections.length })}</h2>
        {canCreate && !readOnly ? (
          <Button id="add-section-button" type="button" size="sm" onClick={() => onAdd(sections.length)}>
            <PlusIcon />
            {t("add")}
          </Button>
        ) : null}
      </div>

      {requirements.length > 0 ? (
        <ul className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs" aria-label={t("requirements.label")} data-testid="section-requirements">
          {requirements.map((r) => (
            <li key={r.key} className={cn("flex items-center gap-1.5", r.met ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
              {r.met ? <CheckIcon className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden />}
              <span>
                {r.kind === "group" && r.key === "group:hero"
                  ? t("requirements.hero")
                  : t("requirements.type", { name: r.label.map((k) => (tTypes.has(k) ? tTypes(k) : k)).join(" / ") })}
                <span className="sr-only">{r.met ? t("requirements.met") : t("requirements.missing")}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <SortableList
          ids={shown.map((s) => String(s.id))}
          disabled={!mutable || pending !== null}
          onMove={(from, to) => void move(from, to)}
          itemLabel={(index) => (shown[index] ? `${index + 1}. ${typeName(shown[index])}` : String(index + 1))}
          className="gap-2"
          renderItem={(id, { index, controls, isDragging }) => {
            const section = byId.get(Number(id));
            if (!section) return null;
            const selected = section.id === selectedId;
            // A reference to a shared section (05 18.9.3) has no props or translations of its own: its name stands in for the excerpt and the
            // language badges are left out (completeness lives with the shared section).
            const shared = section.shared_section ?? null;
            const excerpt = shared ? shared.name : sectionExcerpt(section.props, locale, defaultLocale);
            const missing = shared ? [] : locales.filter((l) => (section.translation_status[l.code]?.missing ?? 0) > 0);
            const issues = issueCounts[section.id] ?? 0;
            const name = typeName(section);
            return (
              <div
                className={cn("rounded-md border bg-card", selected && "border-primary outline outline-1 outline-primary", isDragging && "border-dashed")}
                data-testid={`section-row-${section.id}`}
                data-selected={selected || undefined}
              >
                <div className="flex items-start gap-1 p-1.5">
                  {controls}
                  <button
                    type="button"
                    onClick={() => onSelect(section.id)}
                    aria-current={selected ? "true" : undefined}
                    aria-label={t("open", { index: index + 1, name })}
                    className="min-w-0 flex-1 rounded px-1.5 py-1 text-start hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                      <span className={cn("truncate text-sm font-medium", !section.is_visible && "text-muted-foreground")}>{name}</span>
                      {dirtyId === section.id ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title={t("unsaved")} aria-label={t("unsaved")} /> : null}
                    </span>
                    {excerpt ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{excerpt}</span> : null}
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {!section.is_visible ? (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <EyeOffIcon className="size-3" aria-hidden />
                          {t("hidden")}
                        </Badge>
                      ) : null}
                      {section.unsupported ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {t("unsupported")}
                        </Badge>
                      ) : null}
                      {section.required ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t("required")}
                        </Badge>
                      ) : null}
                      {shared ? (
                        <Badge variant="outline" className="gap-1 text-[10px]" data-testid="shared-badge">
                          <Link2Icon className="size-3" aria-hidden />
                          {t("shared.badge")}
                        </Badge>
                      ) : null}
                      {shared && shared.deleted_at ? (
                        <Badge variant="destructive" className="gap-1 text-[10px]" data-testid="shared-state-badge">
                          <AlertTriangleIcon className="size-3" aria-hidden />
                          {t("shared.trashed")}
                        </Badge>
                      ) : shared && !shared.live ? (
                        <Badge variant="secondary" className="gap-1 text-[10px] text-amber-800 dark:text-amber-200" data-testid="shared-state-badge" title={t("shared.notLiveHint")}>
                          <AlertTriangleIcon className="size-3" aria-hidden />
                          {t("shared.notLive")}
                        </Badge>
                      ) : null}
                      {shared ? null : missing.length === 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700 dark:text-emerald-300" title={t("complete")}>
                          <CheckIcon className="size-3" aria-hidden />
                          <span className="sr-only">{t("complete")}</span>
                        </span>
                      ) : (
                        missing.map((l) => (
                          <span
                            key={l.code}
                            className="inline-flex items-center gap-0.5 text-[11px] text-amber-700 dark:text-amber-300"
                            title={t("missingIn", { locale: l.code.toUpperCase(), count: section.translation_status[l.code]?.missing ?? 0 })}
                            aria-label={t("missingIn", { locale: l.code.toUpperCase(), count: section.translation_status[l.code]?.missing ?? 0 })}
                          >
                            <span className="font-mono uppercase">{l.code}</span>
                            <AlertTriangleIcon className="size-3" aria-hidden />
                            {section.translation_status[l.code]?.missing}
                          </span>
                        ))
                      )}
                      {issues > 0 ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {t("issues", { count: issues })}
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                  {mutable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      disabled={toggling === section.id}
                      aria-pressed={!section.is_visible}
                      aria-label={section.is_visible ? t("hide", { name }) : t("show", { name })}
                      onClick={() => void toggle(section)}
                    >
                      {section.is_visible ? <EyeIcon /> : <EyeOffIcon />}
                    </Button>
                  ) : null}
                  {!readOnly && (canCreate || canDelete || (canUpdate && shared && onDetach)) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t("menu", { name })}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canCreate ? (
                          <>
                            <DropdownMenuItem onSelect={() => onAdd(index)}>{t("insertAbove")}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAdd(index + 1)}>{t("insertBelow")}</DropdownMenuItem>
                          </>
                        ) : null}
                        {shared && canUpdate && onDetach ? (
                          <DropdownMenuItem onSelect={() => onDetach(section)}>
                            <UnlinkIcon />
                            {t("shared.detach")}
                          </DropdownMenuItem>
                        ) : null}
                        {canDelete && !section.required ? (
                          <>
                            {canCreate || (shared && canUpdate) ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(section)}>
                              <Trash2Icon />
                              {t("delete")}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
