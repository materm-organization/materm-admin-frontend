"use client";

import { ChevronDownIcon, EyeOffIcon, PlusIcon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { SortableList } from "@/components/global/sortable-list";
import { itemDraftsEqual, type FaqEditMode, type FaqItemDraft, type FaqRowDraft } from "@/components/protected/faq/faq-draft";
import { FaqRowFields } from "@/components/protected/faq/faq-row-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { MAX_FAQ_ITEMS } from "@/lib/faq";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/locales";
import type { FaqItem } from "@/types/faq";

export type FaqItemsProps = {
  items: FaqItem[] | undefined;
  isLoading: boolean;
  mode: FaqEditMode;
  canCreate: boolean;
  canDelete: boolean;
  locales: Locale[];
  defaultLocale: string;
  locale: string;
  onLocaleChange: (code: string) => void;
  // Unsaved edits by item id (an entry equal to its baseline is "not edited").
  edits: Record<number, FaqItemDraft>;
  baselineOf: (item: FaqItem) => FaqItemDraft;
  problemsOf: (id: number) => Record<string, string>;
  onEdit: (id: number, draft: FaqItemDraft) => void;
  onDiscard: (id: number) => void;
  onSave: (item: FaqItem) => void;
  savingId: number | null;
  expanded: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onToggleVisible: (item: FaqItem, visible: boolean) => void;
  onAdd: () => void;
  onDelete: (item: FaqItem, position: number) => void;
  onMove: (from: number, to: number) => void;
};

// SCR-30 Questions tab (doc/07 section 3.18): an accordion of the questions in the order they show. Drag / keyboard / buttons reorder (one
// `PUT .../order` at once), the switch hides a question (saved at once), a question opens to edit its texts in the chosen language and has
// its own Save; "Save draft" of the bar saves every open edit. `translate` edits the texts only: no drag, no switch, no add, no delete.
export function FaqItems(p: FaqItemsProps) {
  const t = useTranslations("faq.items");
  const rows = p.items ?? [];
  const localeName = p.locales.find((l) => l.code === p.locale)?.native_name ?? p.locale;
  const full = p.mode === "full";

  return (
    <div className="space-y-4" data-testid="faq-items">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground" data-testid="faq-items-count">{t("count", { count: rows.length, max: MAX_FAQ_ITEMS })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <EditorLocaleSwitcher locales={p.locales} value={p.locale} onChange={p.onLocaleChange} />
          {p.canCreate ? (
            <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_FAQ_ITEMS} onClick={p.onAdd}>
              <PlusIcon />
              {t("add")}
            </Button>
          ) : null}
        </div>
      </div>
      {p.canCreate && rows.length >= MAX_FAQ_ITEMS ? <p className="text-xs text-muted-foreground">{t("full", { max: MAX_FAQ_ITEMS })}</p> : null}

      {p.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{p.canCreate ? t("empty") : t("emptyReadOnly")}</p>
      ) : (
        <SortableList
          ids={rows.map((r) => String(r.id))}
          disabled={!full}
          itemLabel={(i) => t("itemLabel", { n: i + 1 })}
          onMove={p.onMove}
          renderItem={(key, { controls, index }) => {
            const item = rows.find((r) => String(r.id) === key)!;
            const open = p.expanded.has(item.id);
            const baseline = p.baselineOf(item);
            const draft = p.edits[item.id] ?? baseline;
            const dirty = p.edits[item.id] !== undefined && !itemDraftsEqual(draft, baseline);
            const preview = item.translations[p.locale]?.question || item.translations[p.defaultLocale]?.question || "";
            const problems = p.problemsOf(item.id);
            const panelId = `faq-item-panel-${item.id}`;
            const hasRow = Boolean(item.translations[p.locale]) || Boolean(draft.rows[p.locale]?.question || draft.rows[p.locale]?.answer);
            const textsEditable = p.mode !== "none" && (full || p.mode === "translate");
            return (
              <div data-testid={`faq-item-${item.id}`} className={cn("rounded-md border bg-card", !item.is_visible && "border-dashed")}>
                <div className="flex flex-wrap items-center gap-2 p-2 sm:flex-nowrap">
                  {controls}
                  <span className="w-6 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{index + 1}.</span>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1.5 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => p.onToggle(item.id)}
                  >
                    <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
                    <span className={cn("truncate text-sm font-medium", !preview && "text-muted-foreground")}>{preview || t("noQuestion")}</span>
                  </button>
                  {dirty ? <Badge variant="outline" className="shrink-0" data-testid={`faq-item-dirty-${item.id}`}>{t("unsaved")}</Badge> : null}
                  {!item.is_visible ? (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <EyeOffIcon className="size-3" aria-hidden />
                      {t("hidden")}
                    </Badge>
                  ) : null}
                  {full ? (
                    <Switch
                      checked={item.is_visible}
                      aria-label={t("visibleSwitch", { n: index + 1 })}
                      onCheckedChange={(v) => p.onToggleVisible(item, v)}
                    />
                  ) : null}
                  {p.canDelete ? (
                    <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("delete", { n: index + 1 })} onClick={() => p.onDelete(item, index + 1)}>
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
                {open ? (
                  <div id={panelId} className="space-y-4 border-t p-4" data-testid={`faq-item-panel-${item.id}`}>
                    {p.mode === "translate" && !hasRow ? <p className="text-xs text-muted-foreground">{t("translateAddsRow", { language: localeName })}</p> : null}
                    <FaqRowFields
                      idPrefix={`faq-item-${item.id}`}
                      locale={p.locale}
                      localeName={localeName}
                      row={draft.rows[p.locale]}
                      disabled={!textsEditable}
                      problems={problems}
                      onChange={(row: FaqRowDraft) => p.onEdit(item.id, { rows: { ...draft.rows, [p.locale]: row } })}
                    />
                    {problems.item ? <p role="alert" className="text-sm text-destructive">{problems.item}</p> : null}
                    {textsEditable ? (
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={!dirty || p.savingId === item.id} onClick={() => p.onDiscard(item.id)}>
                          <Undo2Icon />
                          {t("discard")}
                        </Button>
                        <Button type="button" size="sm" disabled={!dirty || p.savingId === item.id} onClick={() => p.onSave(item)}>
                          {p.savingId === item.id ? <Spinner /> : <SaveIcon />}
                          {t("save")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
