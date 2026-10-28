"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { RevisionsTab } from "@/components/global/revisions/revisions-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { invalidateUiStrings, useMutationDeleteUiString, useMutationPutUiString } from "@/hooks/use-ui-strings";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { analyzeIcu, checkIcuValue } from "@/lib/icu";
import { fetchUiStringRestoreEtag } from "@/lib/ui-string-etag";
import { cn } from "@/lib/utils";
import type { ApiFieldError } from "@/types/api";
import type { UiStringItem } from "@/types/ui-strings";

export const MAX_VALUE = 2000;
export const MAX_NOTE = 200;

type Props = {
  item: UiStringItem;
  locale: string;
  localeName: string;
  // `update` can restore the original and the history; `translate` alone only writes values and notes.
  canUpdate: boolean;
  canEdit: boolean;
  onClose: () => void;
  onLocaleChange?: (locale: string) => void;
};

// SCR-34, one key x one language (doc/07 section 3.21): the bundle text (source) next to the editable value, the
// ICU check before the save, "restore the original" (deletes the override) and the key's history.
// Mount while open, keyed by the cell's ETag so a reload starts from the stored state.
export function UiStringSheet({ item, locale, localeName, canUpdate, canEdit, onClose }: Props) {
  const t = useTranslations("uiStrings.sheet");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const put = useMutationPutUiString();
  const del = useMutationDeleteUiString();
  const cell = item.locales[locale];
  const id = useId();

  const initialValue = cell?.value ?? cell?.effective ?? "";
  const [value, setValue] = useState(initialValue);
  const [note, setNote] = useState(cell?.note ?? "");
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState("edit");
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // The set of placeholders the text must keep: the source of THIS language, else the default language's.
  let expected: string[] | null;
  if (cell?.source != null) {
    const r = analyzeIcu(cell.source);
    expected = r.ok ? r.placeholders : item.placeholders;
  } else expected = item.placeholders.length ? item.placeholders : null;

  const liveCheck = value === "" ? null : checkIcuValue(value, expected);
  const dirty = value !== initialValue || note.trim() !== (cell?.note ?? "");
  const tooLong = [...value].length > MAX_VALUE;
  const canSave = canEdit && dirty && value !== "" && !tooLong && [...note].length <= MAX_NOTE && (liveCheck?.ok ?? false) && !put.isPending;

  const checkMessage = (): string | undefined => {
    if (!liveCheck || liveCheck.ok) return undefined;
    return translateFieldError(tErrors, { in: "body", path: "/value", code: liveCheck.code, params: liveCheck.params as ApiFieldError["params"] });
  };
  const serverMessage = issues.find((i) => i.path === "/value");
  const message = checkMessage() ?? (serverMessage ? translateFieldError(tErrors, serverMessage) : undefined);

  const save = async (): Promise<boolean> => {
    if (!canSave) return false;
    try {
      const result = await put.mutateAsync({
        key: item.key,
        locale,
        payload: { value, ...(note.trim() !== (cell?.note ?? "") ? { note: note.trim() === "" ? null : note.trim() } : {}) },
        etag: cell?.etag ?? undefined,
      });
      toast.success(result.data.data.no_change ? t("noChange") : t("saved"));
      onClose();
      return true;
    } catch (error) {
      if (isConflictError(error)) setConflict(true);
      else {
        const parsed = parseApiError(error);
        if (parsed.fieldErrors.length) setIssues(parsed.fieldErrors);
        else toastError(error, t("saveFailed"));
      }
      return false;
    }
  };
  useUnsavedChangesGuard(dirty, { onSave: save });

  const insert = (name: string) => setValue((v) => `${v}{${name}}`);

  return (
    <Sheet open onOpenChange={(open) => !open && !put.isPending && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="break-all font-mono text-base">{item.key}</SheetTitle>
          <SheetDescription>
            {localeName} · {item.in_bundle === false ? t("orphan") : t("description")}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="edit">{t("tabs.edit")}</TabsTrigger>
              <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="space-y-4 pt-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("source")}</p>
                <p className="rounded-md bg-muted/50 p-2 text-sm" data-testid="ui-source">
                  {cell?.source ?? <span className="text-muted-foreground">{t("noSource")}</span>}
                </p>
                {cell?.is_override ? <Badge>{t("override")}</Badge> : null}
              </div>
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-value`}>{t("value")}</Label>
                  <Textarea
                    id={`${id}-value`}
                    rows={5}
                    value={value}
                    disabled={!canEdit || put.isPending}
                    aria-invalid={Boolean(message)}
                    aria-describedby={`${id}-msg`}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setIssues([]);
                    }}
                  />
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <p id={`${id}-msg`} role={message ? "alert" : undefined} className={cn(message ? "text-destructive" : "text-muted-foreground")}>
                      {message ?? (value === "" ? t("emptyHint") : "")}
                    </p>
                    <span className={cn("shrink-0", tooLong ? "text-destructive" : "text-muted-foreground")}>{[...value].length} / {MAX_VALUE}</span>
                  </div>
                  {item.placeholders.length ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">{t("placeholders")}</span>
                      {item.placeholders.map((p) => (
                        <button
                          key={p}
                          type="button"
                          disabled={!canEdit}
                          className="rounded border px-1.5 py-0.5 font-mono hover:bg-accent disabled:opacity-50"
                          aria-label={t("insertPlaceholder", { name: p })}
                          onClick={() => insert(p)}
                        >
                          {`{${p}}`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {expected === null ? (
                    <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangleIcon className="size-3.5" aria-hidden /> {t("noSourceWarning")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-note`}>{t("note")}</Label>
                  <Input id={`${id}-note`} value={note} disabled={!canEdit || put.isPending} maxLength={MAX_NOTE} autoComplete="off" onChange={(e) => setNote(e.target.value)} />
                </div>
                <SheetFooter className="flex-row flex-wrap justify-between gap-2 p-0">
                  <div>
                    {canUpdate && cell?.value != null ? (
                      <Button type="button" variant="outline" disabled={put.isPending || del.isPending} onClick={() => setConfirmRestore(true)}>
                        <RotateCcwIcon /> {t("restoreOriginal")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={put.isPending}>{t("close")}</Button>
                    {canEdit ? (
                      <Button type="submit" disabled={!canSave}>
                        {put.isPending ? <Spinner /> : <SaveIcon />} {t("save")}
                      </Button>
                    ) : null}
                  </div>
                </SheetFooter>
              </form>
            </TabsContent>
            <TabsContent value="history" className="pt-3">
              <p className="mb-3 text-sm text-muted-foreground">{t("historyNote")}</p>
              <RevisionsTab
                resource="ui-strings"
                id={item.key}
                canRestore={canUpdate}
                // A key has no single-entity GET: the ETag of a restore is read from the history list (lib/ui-string-etag.ts).
                resolveEtag={() => fetchUiStringRestoreEtag(item.key)}
                onRefresh={() => invalidateUiStrings(queryClient)}
                onRestored={() => {
                  void invalidateUiStrings(queryClient);
                  toast.success(t("restored"));
                  onClose();
                }}
              />
              {savedNote}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>

      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={t("restoreTitle")}
        description={t("restoreDescription", { locale: localeName })}
        confirmLabel={t("restoreConfirm")}
        destructive
        isPending={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync({ key: item.key, locale, etag: cell?.etag ?? undefined });
            toast.success(t("restoredOriginal"));
            setConfirmRestore(false);
            setSavedNote(null);
            onClose();
          } catch (error) {
            setConfirmRestore(false);
            if (isConflictError(error)) setConflict(true);
            else toastError(error, t("restoreFailed"));
          }
        }}
      />
      <ConflictDialog
        open={conflict}
        onOpenChange={setConflict}
        onReload={async () => {
          await invalidateUiStrings(queryClient);
          setConflict(false);
          onClose();
        }}
        myChanges={[{ label: localeName, value: value }]}
      />
    </Sheet>
  );
}
