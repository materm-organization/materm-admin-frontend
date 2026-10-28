"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, ArrowLeftIcon, EyeOffIcon, GlobeIcon, LinkIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { RevisionsTab } from "@/components/global/revisions/revisions-tab";
import { SortableList } from "@/components/global/sortable-list";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { ErrorState } from "@/components/global/states/error-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { NoPermission } from "@/components/layout/no-permission";
import { MenuItemForm } from "@/components/protected/menus/menu-item-form";
import { menuSnapshotOf } from "@/components/protected/menus/menu-draft";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLocales } from "@/hooks/use-locales";
import { menuQueryKey, useMenu, useMutationDeleteMenuItem, useMutationReorderMenuItems } from "@/hooks/use-menus";
import { useCan } from "@/hooks/use-permission";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { axiosInstance } from "@/lib/axios";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types/api";
import type { MenuDetail, MenuItem } from "@/types/menus";

export type PageOption = { id: number; title: string; path: string; status: string };

// The pages a menu item can point at (`GET /pages`, working copy). <= 100: the site has a handful of pages.
function usePageOptions() {
  return useQuery({
    queryKey: [API_ENDPOINTS.PAGES.LIST, "menu-picker"],
    queryFn: async () => {
      const { data } = await axiosInstance.get<ApiResponse<Array<Record<string, unknown>>>>(API_ENDPOINTS.PAGES.LIST, { params: { limit: 100 } });
      return (data.data ?? [])
        .filter((r) => typeof r.id === "number")
        .map((r): PageOption => ({
          id: r.id as number,
          title: String(r.title ?? r.name ?? r.id),
          path: String(r.path ?? ""),
          status: String(r.status ?? ""),
        }));
    },
    staleTime: 30_000,
  });
}

// SCR-18 (doc/07 section 3.10): the editor of one flat menu. Left: the items (drag, keyboard, up / down; the new order
// is sent once with "Save order"); right: the form of the chosen item. Every write carries `If-Match` = the menu's
// ETag and the answer's new ETag replaces it in the cache. `translate` alone edits the labels only.
export function MenuEditor({ menuKey }: { menuKey: string }) {
  const t = useTranslations("menus");
  const query = useMenu(menuKey);
  const { data: localesData, isLoading: localesLoading } = useLocales();
  const menu = query.data?.data.data;
  useBreadcrumbTitle(menu ? (t.has(`names.${menu.key}`) ? t(`names.${menu.key}`) : menu.name) : undefined);

  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && parseApiError(query.error).status === 404) {
    return <NotFoundState title={t("notFoundTitle")} description={t("notFoundDescription")} backHref="/admin/menus" backLabel={t("backToMenus")} />;
  }
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!query.data || !menu || localesLoading) return <EditorSkeleton />;

  const locales = (localesData?.data ?? []).filter((l) => l.is_active);
  const defaultLocale = localesData?.data.find((l) => l.is_default)?.code ?? "la";
  return <MenuEditorBody menu={menu} etag={query.data.etag} locales={locales} defaultLocale={defaultLocale} reload={() => query.refetch()} />;
}

type BodyProps = {
  menu: MenuDetail;
  etag: string | undefined;
  locales: Array<{ code: string; name: string; native_name: string; short_label: string; is_default: boolean; sort_order: number }>;
  defaultLocale: string;
  reload: () => Promise<unknown>;
};

function MenuEditorBody({ menu, etag, locales, defaultLocale, reload }: BodyProps) {
  const t = useTranslations("menus");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const canUpdate = useCan(PERMISSION_KEYS.CMS_MENUS, "update");
  const canCreate = useCan(PERMISSION_KEYS.CMS_MENUS, "create");
  const canDelete = useCan(PERMISSION_KEYS.CMS_MENUS, "delete");
  const canTranslate = useCan(PERMISSION_KEYS.CMS_MENUS, "translate");
  const translateOnly = canTranslate && !canUpdate;
  const canEditItems = canUpdate || canTranslate;

  const reorder = useMutationReorderMenuItems(menu.key);
  const remove = useMutationDeleteMenuItem(menu.key);
  const pages = usePageOptions();

  const [locale, setLocale] = useState(defaultLocale);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const [toDelete, setToDelete] = useState<MenuItem | null>(null);
  const [pendingSelect, setPendingSelect] = useState<number | "new" | null | undefined>(undefined);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState("items");
  const [formVersion, setFormVersion] = useState(0);
  const formDirty = useRef(false);

  const serverIds = useMemo(() => menu.items.map((i) => i.id), [menu.items]);
  const ids = useMemo(() => {
    if (!localOrder) return serverIds;
    const known = localOrder.filter((id) => serverIds.includes(id));
    return [...known, ...serverIds.filter((id) => !known.includes(id))];
  }, [localOrder, serverIds]);
  const orderDirty = localOrder !== null && ids.some((id, i) => id !== serverIds[i]);
  const byId = useMemo(() => new Map(menu.items.map((i) => [i.id, i])), [menu.items]);

  const current = selected ?? ids[0] ?? null;
  const selectedItem = typeof current === "number" ? byId.get(current) : undefined;

  const saveOrder = async (): Promise<boolean> => {
    try {
      await reorder.mutateAsync({ payload: { items: ids.map((id) => ({ id, parent_id: null })) }, etag });
      setLocalOrder(null);
      toast.success(t("toast.orderSaved"));
      return true;
    } catch (error) {
      if (isConflictError(error)) setConflictOpen(true);
      else toastError(error, t("toast.orderFailed"));
      return false;
    }
  };
  useUnsavedChangesGuard(orderDirty, { onSave: saveOrder });

  const choose = (next: number | "new" | null) => {
    if (formDirty.current) setPendingSelect(next);
    else setSelected(next);
  };

  const missingByLocale = (code: string) => menu.items.filter((i) => !(i.translations[code]?.label ?? "").trim()).length;
  const completeness = Object.fromEntries(
    locales.map((l): [string, LocaleBadge] => {
      const missing = missingByLocale(l.code);
      return [l.code, { missing, total: menu.items.length, status: missing === 0 ? "complete" : missing === menu.items.length ? "missing" : "partial" }];
    })
  );

  const short = (code: string) => locales.find((l) => l.code === code)?.short_label || code.toUpperCase();
  const labelOf = (item: MenuItem) => {
    const own = item.translations[locale]?.label?.trim();
    if (own) return { text: own, missing: false };
    return { text: item.translations[defaultLocale]?.label ?? `#${item.id}`, missing: true };
  };

  const limits = menu.limits;
  const tooMany = limits.recommended_max_items !== null && menu.items.length > limits.recommended_max_items;
  const atLimit = menu.items.length >= limits.max_items;
  const menuName = t.has(`names.${menu.key}`) ? t(`names.${menu.key}`) : menu.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link href="/admin/menus">
              <ArrowLeftIcon /> {t("backToMenus")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-wide">{menuName}</h1>
          <p className="mt-1 text-base text-muted-foreground">{t("editorDescription")}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="items">{t("tabs.items")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-4 pt-2">
          {translateOnly ? (
            <Alert>
              <AlertTitle>{t("translateOnly.title")}</AlertTitle>
              <AlertDescription>{t("translateOnly.description")}</AlertDescription>
            </Alert>
          ) : !canEditItems ? (
            <Alert>
              <AlertTitle>{t("readOnly.title")}</AlertTitle>
              <AlertDescription>{t("readOnly.description")}</AlertDescription>
            </Alert>
          ) : null}
          {tooMany ? (
            <Alert role="status" data-testid="menu-too-many">
              <AlertTriangleIcon />
              <AlertTitle>{t("tooMany.title")}</AlertTitle>
              <AlertDescription>{t("tooMany.description", { count: menu.items.length, recommended: limits.recommended_max_items ?? 0 })}</AlertDescription>
            </Alert>
          ) : null}
          <p className="text-sm text-muted-foreground">{t("liveNote")}</p>

          <EditorLocaleSwitcher locales={locales} value={locale} onChange={setLocale} completeness={completeness} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <section aria-labelledby="menu-items-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="menu-items-heading" className="text-sm font-semibold">
                  {t("items.title", { count: menu.items.length, max: limits.max_items })}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {canCreate && !translateOnly ? (
                    <Button type="button" size="sm" variant="outline" disabled={atLimit} onClick={() => choose("new")}>
                      <PlusIcon /> {t("items.add")}
                    </Button>
                  ) : null}
                  {orderDirty && canUpdate ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" disabled={reorder.isPending} onClick={() => setLocalOrder(null)}>
                        {t("items.discardOrder")}
                      </Button>
                      <Button type="button" size="sm" disabled={reorder.isPending} onClick={() => void saveOrder()}>
                        {reorder.isPending ? <Spinner /> : <SaveIcon />} {t("items.saveOrder")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {atLimit ? <p className="text-sm text-muted-foreground">{t("items.atLimit", { max: limits.max_items })}</p> : null}
              {menu.items.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("items.empty")}</p>
              ) : (
                <SortableList
                  ids={ids.map(String)}
                  disabled={!canUpdate || reorder.isPending}
                  itemLabel={(index) => {
                    const item = byId.get(ids[index]);
                    return item ? labelOf(item).text : t("items.item", { n: index + 1 });
                  }}
                  onMove={(from, to) => {
                    const next = [...ids];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    setLocalOrder(next);
                  }}
                  renderItem={(id, { controls, isDragging }) => {
                    const item = byId.get(Number(id));
                    if (!item) return null;
                    const label = labelOf(item);
                    const active = current === item.id;
                    return (
                      <div className={cn("flex items-center gap-2 rounded-md border bg-card p-2", active && "border-primary", isDragging && "opacity-70")}>
                        {canUpdate ? controls : null}
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left focus-visible:outline-2"
                          aria-current={active ? "true" : undefined}
                          onClick={() => choose(item.id)}
                        >
                          <span className={cn("block truncate text-sm font-medium", label.missing && "text-muted-foreground italic")}>
                            {label.text}
                            {label.missing ? (
                              <span className="ml-1 not-italic" title={t("items.missingLabel", { locale: short(locale) })}>
                                <AlertTriangleIcon className="inline size-3.5 text-amber-600" aria-hidden />
                                <span className="sr-only">{t("items.missingLabel", { locale: short(locale) })}</span>
                              </span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            {item.link.type === "page" ? <GlobeIcon className="size-3" aria-hidden /> : <LinkIcon className="size-3" aria-hidden />}
                            {item.link.type === "page" ? (item.page?.path ?? `#${item.link.page_id}`) : item.link.url}
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {!item.is_visible ? (
                            <Badge variant="outline">
                              <EyeOffIcon aria-hidden /> {t("items.hidden")}
                            </Badge>
                          ) : null}
                          {item.link_state === "page_unpublished" || item.link_state === "page_trashed" ? (
                            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                              {item.link_state === "page_trashed" ? t("items.pageTrashed") : t("items.pageUnpublished")}
                            </Badge>
                          ) : null}
                          {item.icon ? <Badge variant="secondary">{item.icon}</Badge> : null}
                        </div>
                        {canDelete && !translateOnly ? (
                          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("items.deleteItem", { name: label.text })} onClick={() => setToDelete(item)}>
                            <Trash2Icon />
                          </Button>
                        ) : null}
                      </div>
                    );
                  }}
                />
              )}
            </section>

            <section aria-labelledby="menu-form-heading" className="rounded-lg border p-4">
              {current === "new" ? (
                <MenuItemForm
                  key={`new-${formVersion}`}
                  menu={menu}
                  etag={etag}
                  item={null}
                  locale={locale}
                  onLocaleChange={setLocale}
                  locales={locales}
                  defaultLocale={defaultLocale}
                  pages={pages.data ?? []}
                  canEdit={canCreate}
                  translateOnly={false}
                  onDirtyChange={(d) => { formDirty.current = d; }}
                  onSaved={(item) => {
                    formDirty.current = false;
                    setFormVersion((v) => v + 1);
                    setSelected(item?.id ?? null);
                  }}
                  onConflict={() => setConflictOpen(true)}
                  onCancel={() => choose(null)}
                />
              ) : selectedItem ? (
                <MenuItemForm
                  key={`${selectedItem.id}-${selectedItem.updated_at}-${formVersion}`}
                  menu={menu}
                  etag={etag}
                  item={selectedItem}
                  locale={locale}
                  onLocaleChange={setLocale}
                  locales={locales}
                  defaultLocale={defaultLocale}
                  pages={pages.data ?? []}
                  canEdit={canEditItems}
                  translateOnly={translateOnly}
                  onDirtyChange={(d) => { formDirty.current = d; }}
                  onSaved={() => {
                    formDirty.current = false;
                  }}
                  onConflict={() => setConflictOpen(true)}
                />
              ) : (
                <p id="menu-form-heading" className="py-8 text-center text-sm text-muted-foreground">
                  {t("form.select")}
                </p>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          <RevisionsTab
            resource="menus"
            id={menu.key}
            canRestore={canUpdate}
            etag={etag}
            currentSnapshot={menuSnapshotOf(menu)}
            onRefresh={reload}
            onRestored={({ data, etag: nextEtag }) => {
              // The restore answers the menu in the shape of `GET /menus/{key}` with its new ETag.
              queryClient.setQueryData(menuQueryKey(menu.key), { data: { success: true, data: data as unknown as MenuDetail }, etag: nextEtag });
              void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MENUS.LIST] });
              setLocalOrder(null);
              setSelected(null);
              formDirty.current = false;
              toast.success(t("toast.restored"));
              setTab("items");
            }}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { name: toDelete ? labelOf(toDelete).text : "" })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        isPending={remove.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync({ id: toDelete.id, etag });
            toast.success(t("toast.deleted"));
            if (selected === toDelete.id) setSelected(null);
            setLocalOrder((o) => (o ? o.filter((id) => id !== toDelete.id) : o));
            setToDelete(null);
          } catch (error) {
            setToDelete(null);
            if (isConflictError(error)) setConflictOpen(true);
            else toastError(error, t("toast.deleteFailed"));
          }
        }}
      />

      <ConfirmDialog
        open={pendingSelect !== undefined}
        onOpenChange={(open) => !open && setPendingSelect(undefined)}
        title={t("discard.title")}
        description={t("discard.description")}
        confirmLabel={t("discard.confirm")}
        destructive
        onConfirm={() => {
          formDirty.current = false;
          setSelected(pendingSelect ?? null);
          setPendingSelect(undefined);
        }}
      />

      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        isReloading={reloading}
        onReload={async () => {
          setReloading(true);
          try {
            await reload();
            setLocalOrder(null);
            setFormVersion((v) => v + 1);
            formDirty.current = false;
            setConflictOpen(false);
          } finally {
            setReloading(false);
          }
        }}
      />
    </div>
  );
}
