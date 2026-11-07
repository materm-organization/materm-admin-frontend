"use client";

import { useTranslations } from "next-intl";
import { Link2Icon } from "lucide-react";
import { useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useSectionTypes } from "@/hooks/use-section-types";
import { useSharedSections } from "@/hooks/use-shared-sections";
import { cn } from "@/lib/utils";
import type { PageTemplate, SectionSummary } from "@/types/pages";

import { addOptions, resolvePosition } from "./section-structure";

// SectionTypePicker (doc/07 SCR-20): the section types that are active AND allowed by the page's template; one that
// reached its `max_per_page` is shown disabled with the reason. A hero goes to the top and a section that has to follow
// the hero goes below it, whatever position was asked for (said under the cards). No example pictures (Q-07-6).
export function SectionTypePicker({
  open,
  onOpenChange,
  template,
  sections,
  position,
  onPick,
  pageId,
  onPickShared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: PageTemplate;
  sections: SectionSummary[];
  // Where the author asked to add (0 = top).
  position: number;
  // Resolves when the section exists (the dialog then closes); rejects when it was refused (the dialog stays).
  onPick: (typeKey: string, position: number, idempotencyKey: string) => Promise<unknown>;
  // The "Shared" tab (05 18.4 `placeable_on_page`, 18.9.1): present when `pageId` and `onPickShared` are given and the user may read shared sections.
  pageId?: number;
  onPickShared?: (sharedSectionId: number, typeKey: string, position: number, idempotencyKey: string) => Promise<unknown>;
}) {
  const t = useTranslations("pages.editor.picker");
  const tTypes = useTranslations("publishing.sectionTypes");
  const key = useIdempotencyKey(open);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"types" | "shared">("types");
  const [keyword, setKeyword] = useState("");
  const sharedEnabled = Boolean(pageId && onPickShared);
  const shared = useSharedSections({ placeable_on_page: pageId, keyword: keyword.trim() || undefined, limit: 30, sort: "name" }, open && sharedEnabled && tab === "shared");
  const types = useSectionTypes({ is_active: true, scope: "page" }, open);
  const options = addOptions(template, sections);
  const describe = (typeKey: string) => types.data?.data.find((x) => x.key === typeKey);

  const pick = async (typeKey: string) => {
    setBusy(typeKey);
    try {
      await onPick(typeKey, resolvePosition(template, sections, typeKey, position), key);
      onOpenChange(false);
    } catch {
      // the caller shows what was refused
    } finally {
      setBusy(null);
    }
  };

  const pickShared = async (id: number, typeKey: string) => {
    setBusy(`shared:${id}`);
    try {
      await onPickShared?.(id, typeKey, resolvePosition(template, sections, typeKey, position), key);
      onOpenChange(false);
    } catch {
      // the caller shows what was refused
    } finally {
      setBusy(null);
    }
  };

  const typesList = (
    <>
    {types.isPending && template ? (
      <div className="grid gap-2 sm:grid-cols-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    ) : types.error ? (
      <ErrorState error={types.error} onRetry={() => void types.refetch()} isRetrying={types.isFetching} />
    ) : (
      <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("list")}>
        {options.map(({ type, disabledReason, max }) => {
          const info = describe(type.section_type_key);
          const name = tTypes.has(type.section_type_key) ? tTypes(type.section_type_key) : type.name;
          const disabled = disabledReason !== null || busy !== null;
          return (
            <li key={type.section_type_key}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void pick(type.section_type_key)}
                className={cn(
                  "flex h-full w-full flex-col items-start gap-1 rounded-md border p-3 text-start transition-colors",
                  disabled ? "cursor-not-allowed opacity-60" : "hover:border-primary hover:bg-muted/40"
                )}
              >
                <span className="flex w-full items-center gap-2 text-sm font-medium">
                  {name}
                  {busy === type.section_type_key ? <Spinner /> : null}
                </span>
                {info?.description ? <span className="text-xs text-muted-foreground">{info.description}</span> : null}
                {disabledReason === "max" ? <span className="text-xs text-amber-700 dark:text-amber-300">{t("max", { max: max ?? 1 })}</span> : null}
                {type.required ? <span className="text-xs text-muted-foreground">{t("requiredByTemplate")}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    )}
    </>
  );

  const sharedList = (
    <div className="space-y-3" data-testid="shared-picker">
      <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t("shared.search")} aria-label={t("shared.search")} maxLength={100} />
      {shared.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : shared.error ? (
        <ErrorState error={shared.error} onRetry={() => void shared.refetch()} isRetrying={shared.isFetching} />
      ) : (shared.data?.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="shared-picker-empty">
          {keyword.trim() ? t("shared.noMatch") : t("shared.empty")}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("shared.list")}>
          {(shared.data?.data ?? []).map((item) => {
            const typeKey = item.section_type.key;
            const max = options.find((o) => o.type.section_type_key === typeKey)?.disabledReason === "max";
            const disabled = max || busy !== null;
            const typeName = tTypes.has(typeKey) ? tTypes(typeKey) : item.section_type.name;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`shared-option-${item.id}`}
                  onClick={() => void pickShared(item.id, typeKey)}
                  className={cn(
                    "flex h-full w-full flex-col items-start gap-1 rounded-md border p-3 text-start transition-colors",
                    disabled ? "cursor-not-allowed opacity-60" : "hover:border-primary hover:bg-muted/40"
                  )}
                >
                  <span className="flex w-full items-center gap-2 text-sm font-medium">
                    <Link2Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{item.name}</span>
                    {busy === `shared:${item.id}` ? <Spinner /> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{typeName}</span>
                  {item.status !== "published" ? <span className="text-xs text-amber-700 dark:text-amber-300">{t("shared.notPublished")}</span> : null}
                  {max ? <span className="text-xs text-amber-700 dark:text-amber-300">{t("max", { max: options.find((o) => o.type.section_type_key === typeKey)?.max ?? 1 })}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {sharedEnabled ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "types" | "shared")}>
            <TabsList>
              <TabsTrigger value="types">{t("tabs.types")}</TabsTrigger>
              <TabsTrigger value="shared">{t("tabs.shared")}</TabsTrigger>
            </TabsList>
            <TabsContent value="types" className="pt-2">
              {typesList}
            </TabsContent>
            <TabsContent value="shared" className="pt-2">
              {sharedList}
            </TabsContent>
          </Tabs>
        ) : (
          typesList
        )}
        <p className="text-xs text-muted-foreground">{t("positionNote")}</p>
      </DialogContent>
    </Dialog>
  );
}
