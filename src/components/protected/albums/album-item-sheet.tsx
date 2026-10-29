"use client";

import { ImagePlusIcon, LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { MediaPicker } from "@/components/protected/media/media-picker";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import type { AlbumEditMode } from "@/components/protected/albums/album-draft";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { LAYOUT_HINT_PATTERN, MAX_CAPTION_DESCRIPTION, MAX_CAPTION_TITLE, MAX_ITEM_ALT, charCount } from "@/lib/albums";
import type { AlbumItem, UpdateAlbumItemPayload } from "@/types/albums";
import type { ApiFieldError } from "@/types/api";
import type { MediaAssetOption } from "@/types/cms";
import type { Locale } from "@/types/locales";
import type { SettingsMediaRef } from "@/types/settings";

type Texts = { caption_title: string; caption_description: string; alt: string };
type ItemDraft = { media_id: number; media: SettingsMediaRef; layout_hint: string; texts: Record<string, Texts> };

const blankTexts = (): Texts => ({ caption_title: "", caption_description: "", alt: "" });

export function draftFromItem(item: AlbumItem, localeCodes: readonly string[]): ItemDraft {
  const texts: Record<string, Texts> = {};
  for (const code of localeCodes) {
    const row = item.translations[code];
    texts[code] = { caption_title: row?.caption_title ?? "", caption_description: row?.caption_description ?? "", alt: row?.alt ?? "" };
  }
  return { media_id: item.media_id, media: item.media, layout_hint: item.layout_hint ?? "", texts };
}

const sameDraft = (a: ItemDraft, b: ItemDraft) =>
  a.media_id === b.media_id && a.layout_hint === b.layout_hint && Object.keys({ ...a.texts, ...b.texts }).every((code) => {
    const x = a.texts[code] ?? blankTexts();
    const y = b.texts[code] ?? blankTexts();
    return x.caption_title === y.caption_title && x.caption_description === y.caption_description && x.alt === y.alt;
  });

// Only what changed. A cleared text is sent as `null` (a language row is never removed from here: that is `update` and a row with no texts is valid).
export function buildItemPatch(baseline: ItemDraft, edit: ItemDraft, mode: AlbumEditMode): UpdateAlbumItemPayload | null {
  if (mode === "none") return null;
  const patch: UpdateAlbumItemPayload = {};
  if (mode === "full") {
    if (edit.media_id !== baseline.media_id) patch.media_id = edit.media_id;
    if (edit.layout_hint !== baseline.layout_hint) patch.layout_hint = edit.layout_hint.trim() === "" ? null : edit.layout_hint.trim();
  }
  const translations: NonNullable<UpdateAlbumItemPayload["translations"]> = {};
  for (const [code, row] of Object.entries(edit.texts)) {
    const base = baseline.texts[code] ?? blankTexts();
    const part: Record<string, string | null> = {};
    for (const field of ["caption_title", "caption_description", "alt"] as const) {
      if (row[field] !== base[field]) part[field] = row[field].trim() === "" ? null : row[field];
    }
    if (Object.keys(part).length > 0) translations[code] = part;
  }
  if (Object.keys(translations).length > 0) patch.translations = translations;
  return Object.keys(patch).length > 0 ? patch : null;
}

type Props = {
  // `null` = closed.
  item: AlbumItem | null;
  position: number;
  onClose: () => void;
  locales: Locale[];
  defaultLocale: string;
  initialLocale: string;
  mode: AlbumEditMode;
  save: (itemId: number, payload: UpdateAlbumItemPayload) => Promise<unknown>;
  onConflict: () => void;
  onStale: () => void;
};

// SCR-29 picture sheet (doc/07 section 3.17): caption title, caption description and alt text in each language, the layout hint, the
// picture itself. An empty alt text means "use the alt text of the picture in the library" (FR-GAL-03). `translate` edits the texts only.
export function AlbumItemSheet(props: Props) {
  const { item } = props;
  // Escape, the X and a click outside all go through the body's `requestClose` (it asks first when there are unsaved edits).
  const closeRef = useRef<() => void>(() => undefined);
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && closeRef.current()}>
      {item ? <SheetBody key={item.id} {...props} item={item} closeRef={closeRef} /> : null}
    </Sheet>
  );
}

function SheetBody({ item, position, onClose, locales, defaultLocale, initialLocale, mode, save, onConflict, onStale, closeRef }: Props & { item: AlbumItem; closeRef: MutableRefObject<() => void> }) {
  const t = useTranslations("albums.item");
  const tErr = useTranslations("errors");
  const ids = { hint: useId(), title: useId(), description: useId(), alt: useId() };
  const { toastError } = useApiErrorHandler();
  const localeCodes = useMemo(() => locales.map((l) => l.code), [locales]);
  const baseline = useMemo(() => draftFromItem(item, localeCodes), [item, localeCodes]);
  const [draft, setDraft] = useState<ItemDraft>(baseline);
  const [locale, setLocale] = useState(locales.some((l) => l.code === initialLocale) ? initialLocale : defaultLocale);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const dirty = !sameDraft(draft, baseline);
  const row = draft.texts[locale] ?? blankTexts();
  const localeName = locales.find((l) => l.code === locale)?.native_name ?? locale;
  const textsEditable = mode !== "none";
  const structure = mode === "full";

  const problems = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [code, r] of Object.entries(draft.texts)) {
      if (charCount(r.caption_title) > MAX_CAPTION_TITLE) out[`caption_title.${code}`] = t("tooLong", { max: MAX_CAPTION_TITLE });
      if (charCount(r.caption_description) > MAX_CAPTION_DESCRIPTION) out[`caption_description.${code}`] = t("tooLong", { max: MAX_CAPTION_DESCRIPTION });
      if (charCount(r.alt) > MAX_ITEM_ALT) out[`alt.${code}`] = t("tooLong", { max: MAX_ITEM_ALT });
    }
    if (draft.layout_hint.trim() !== "" && !LAYOUT_HINT_PATTERN.test(draft.layout_hint.trim())) out.layout_hint = t("hintFormat");
    for (const e of serverErrors) {
      const m = /^\/translations\/([^/]+)\/([a-z_]+)/.exec(e.path);
      out[m ? `${m[2]}.${m[1]}` : e.path === "/layout_hint" ? "layout_hint" : "item"] = translateFieldError(tErr as never, e);
    }
    return out;
  }, [draft, serverErrors, t, tErr]);
  const clientProblem = Object.keys(problems).length > 0 && serverErrors.length === 0;

  const requestClose = () => (dirty ? setDiscardOpen(true) : onClose());
  useEffect(() => {
    closeRef.current = requestClose;
  });
  const set = (patch: Partial<Texts>) => {
    setServerErrors([]);
    setDraft({ ...draft, texts: { ...draft.texts, [locale]: { ...row, ...patch } } });
  };
  const replacePicture = (assets: MediaAssetOption[]) => {
    const a = assets[0];
    if (!a) return;
    setDraft({ ...draft, media_id: a.id, media: { id: a.id, status: a.status ?? "ready", original_filename: a.filename, mime_type: a.mime_type, width: a.width ?? null, height: a.height ?? null, url: a.url ?? null } });
    setPickerOpen(false);
  };

  const submit = async () => {
    const patch = buildItemPatch(baseline, draft, mode);
    if (!patch) return onClose();
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    try {
      await save(item.id, patch);
      toast.success(t("saved"));
      onClose();
    } catch (error) {
      const parsed = parseApiError(error);
      if (isConflictError(error)) onConflict();
      else if (parsed.status === 404) {
        toast.error(t("gone"));
        onStale();
        onClose();
      } else if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => problems[`${key}.${locale}`];

  return (
    <>
      <SheetContent
        className="flex w-full flex-col gap-0 sm:max-w-lg"
        data-testid="album-item-sheet"
      >
        <SheetHeader>
          <SheetTitle>{t("title", { n: position })}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="size-24 shrink-0 overflow-hidden rounded-md border bg-muted">
              <MediaThumb asset={{ url: draft.media.url, mime_type: draft.media.mime_type }} alt={draft.media.original_filename ?? `#${draft.media_id}`} />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="truncate text-sm font-medium" title={draft.media.original_filename}>{draft.media.original_filename ?? `#${draft.media_id}`}</p>
              {structure ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  <ImagePlusIcon />
                  {t("replace")}
                </Button>
              ) : null}
            </div>
          </div>
          {item.in_use ? (
            <Alert data-testid="album-item-in-use">
              <LinkIcon />
              <AlertDescription>{t("inUse", { count: Math.max(item.usage_count, 1) })}</AlertDescription>
            </Alert>
          ) : null}
          {mode === "translate" ? <p className="text-sm text-muted-foreground">{t("translateNote")}</p> : null}

          <EditorLocaleSwitcher locales={locales} value={locale} onChange={setLocale} />
          <div className="space-y-1.5">
            <Label htmlFor={ids.title}>{t("captionTitle", { language: localeName })}</Label>
            <Input id={ids.title} value={row.caption_title} disabled={!textsEditable} aria-invalid={fieldError("caption_title") ? true : undefined} onChange={(e) => set({ caption_title: e.target.value })} />
            <p className="flex justify-between text-xs text-muted-foreground">
              <span role={fieldError("caption_title") ? "alert" : undefined} className={fieldError("caption_title") ? "text-destructive" : undefined}>{fieldError("caption_title") ?? ""}</span>
              <span className="tabular-nums">{charCount(row.caption_title)} / {MAX_CAPTION_TITLE}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.description}>{t("captionDescription", { language: localeName })}</Label>
            <Textarea id={ids.description} rows={3} value={row.caption_description} disabled={!textsEditable} aria-invalid={fieldError("caption_description") ? true : undefined} onChange={(e) => set({ caption_description: e.target.value })} />
            <p className="flex justify-between text-xs text-muted-foreground">
              <span role={fieldError("caption_description") ? "alert" : undefined} className={fieldError("caption_description") ? "text-destructive" : undefined}>{fieldError("caption_description") ?? ""}</span>
              <span className="tabular-nums">{charCount(row.caption_description)} / {MAX_CAPTION_DESCRIPTION}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.alt}>{t("alt", { language: localeName })}</Label>
            <Input
              id={ids.alt}
              value={row.alt}
              disabled={!textsEditable}
              placeholder={t("altPlaceholder")}
              aria-invalid={fieldError("alt") ? true : undefined}
              onChange={(e) => set({ alt: e.target.value })}
            />
            <p className="flex justify-between text-xs text-muted-foreground">
              <span role={fieldError("alt") ? "alert" : undefined} className={fieldError("alt") ? "text-destructive" : undefined}>{fieldError("alt") ?? t("altHint")}</span>
              <span className="tabular-nums">{charCount(row.alt)} / {MAX_ITEM_ALT}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.hint}>{t("layoutHint")}</Label>
            <Input
              id={ids.hint}
              value={draft.layout_hint}
              disabled={!structure}
              spellCheck={false}
              className="font-mono"
              aria-invalid={problems.layout_hint ? true : undefined}
              onChange={(e) => {
                setServerErrors([]);
                setDraft({ ...draft, layout_hint: e.target.value });
              }}
            />
            <p className={problems.layout_hint ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={problems.layout_hint ? "alert" : undefined}>{problems.layout_hint ?? t("layoutHintHint")}</p>
          </div>
          {problems.item ? <Alert variant="destructive"><AlertDescription>{problems.item}</AlertDescription></Alert> : null}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" disabled={saving} onClick={requestClose}>
            {t("cancel")}
          </Button>
          {mode !== "none" ? (
            <Button type="button" disabled={!dirty || saving || clientProblem} onClick={() => void submit()}>
              {saving ? <Spinner /> : null}
              {t("save")}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="single"
        max={1}
        accept="image/*"
        selectedIds={[]}
        title={t("pickerTitle")}
        description={t("pickerDescription")}
        defaultLocale={defaultLocale}
        onSelect={replacePicture}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("discard.title")}
        description={t("discard.description")}
        confirmLabel={t("discard.confirm")}
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
