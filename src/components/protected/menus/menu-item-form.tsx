"use client";

import { AlertTriangleIcon, SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  MAX_ARIA,
  MAX_LABEL,
  buildCreate,
  buildPatch,
  draftFromItem,
  emptyDraft,
  isDraftChanged,
  issueLocale,
  validateDraft,
  type ItemDraft,
} from "@/components/protected/menus/menu-draft";
import type { PageOption } from "@/components/protected/menus/menu-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationCreateMenuItem, useMutationUpdateMenuItem } from "@/hooks/use-menus";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { newIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import type { ApiFieldError } from "@/types/api";
import type { MenuDetail, MenuItem } from "@/types/menus";

type Props = {
  menu: MenuDetail;
  etag: string | undefined;
  // null = a new item.
  item: MenuItem | null;
  locale: string;
  onLocaleChange: (code: string) => void;
  locales: Array<{ code: string; short_label?: string }>;
  defaultLocale: string;
  pages: PageOption[];
  canEdit: boolean;
  translateOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (item: MenuItem | null) => void;
  onConflict: () => void;
  onCancel?: () => void;
};

// The form of one menu item (create or edit). Keyed by the item and its ETag by the parent, so a save, a restore or
// a reload starts from the stored state. Labels are per language (the language switch of the editor); everything
// else belongs to the item. `translateOnly` leaves only the two text fields enabled.
export function MenuItemForm(props: Props) {
  const { menu, etag, item, locale, defaultLocale, pages, canEdit, translateOnly, onDirtyChange, onSaved, onConflict, onCancel } = props;
  const t = useTranslations("menus.form");
  const tErrors = useTranslations("errors");
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateMenuItem(menu.key);
  const update = useMutationUpdateMenuItem(menu.key);
  const saved = useMemo(() => (item ? draftFromItem(item) : emptyDraft(menu.key)), [item, menu.key]);
  const [draft, setDraft] = useState<ItemDraft>(saved);
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [warnings, setWarnings] = useState<string[]>([]);
  const id = useId();
  const short = (code: string) => props.locales.find((l) => l.code === code)?.short_label || code.toUpperCase();
  const social = menu.key === "social";
  const pending = create.isPending || update.isPending;
  const disabled = !canEdit || pending;
  const dirty = isDraftChanged(saved, draft);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const set = (patch: Partial<ItemDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues([]);
  };
  const err = (path: string) => {
    const issue = issues.find((i) => i.path === path);
    return issue ? translateFieldError(tErrors, issue) : undefined;
  };

  const save = async (): Promise<boolean> => {
    const clientIssues = validateDraft(menu.key, draft, defaultLocale, { translateOnly });
    if (clientIssues.length) {
      setIssues(clientIssues);
      const other = clientIssues.map((i) => issueLocale(i.path)).find((c) => c && c !== locale);
      if (other && !clientIssues.some((i) => issueLocale(i.path) === locale)) props.onLocaleChange(other);
      return false;
    }
    try {
      if (item) {
        const payload = buildPatch(saved, draft, defaultLocale, { translateOnly });
        if (Object.keys(payload).length === 0) return true;
        const result = await update.mutateAsync({ id: item.id, payload, etag });
        setWarnings(result.data.data.warnings.map((w) => w.code).filter((c) => c !== "too_many_items"));
        toast.success(t("saved"));
        onSaved(result.data.data.item);
      } else {
        const result = await create.mutateAsync({ payload: buildCreate(menu.key, draft), etag, idempotencyKey });
        toast.success(t("created"));
        onSaved(result.data.data.item);
      }
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        onConflict();
        return false;
      }
      const parsed = parseApiError(error);
      if (parsed.fieldErrors.length) {
        setIssues(parsed.fieldErrors);
        const other = parsed.fieldErrors.map((i) => issueLocale(i.path)).find((c) => c && c !== locale);
        if (other) props.onLocaleChange(other);
      } else toastError(error, t("saveFailed"));
      return false;
    }
  };
  useUnsavedChangesGuard(dirty, { onSave: save });

  const label = draft.labels[locale] ?? "";
  const aria = draft.ariaLabels[locale] ?? "";
  const pageValue = draft.pageId === null ? "" : String(draft.pageId);
  const chosenPage = pages.find((p) => p.id === draft.pageId);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if ((!item || dirty) && canEdit) void save();
      }}
    >
      <h2 id="menu-form-heading" className="text-sm font-semibold">
        {item ? t("editTitle") : t("newTitle")}
      </h2>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-label`}>
          {t("label", { locale: short(locale) })}
          {locale === defaultLocale ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        <Input
          id={`${id}-label`}
          value={label}
          disabled={disabled}
          autoComplete="off"
          placeholder={locale !== defaultLocale ? (draft.labels[defaultLocale] ?? "") : undefined}
          aria-invalid={Boolean(err(`/translations/${locale}/label`))}
          onChange={(e) => set({ labels: { ...draft.labels, [locale]: e.target.value } })}
        />
        <FieldFoot error={err(`/translations/${locale}/label`)} counter={[...label.trim()].length} max={MAX_LABEL} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-aria`}>{t("ariaLabel", { locale: short(locale) })}</Label>
        <Input
          id={`${id}-aria`}
          value={aria}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(err(`/translations/${locale}/aria_label`))}
          onChange={(e) => set({ ariaLabels: { ...draft.ariaLabels, [locale]: e.target.value } })}
        />
        <FieldFoot error={err(`/translations/${locale}/aria_label`)} help={t("ariaHelp")} counter={[...aria.trim()].length} max={MAX_ARIA} />
      </div>

      <fieldset className="space-y-3 border-t pt-4" disabled={disabled || translateOnly}>
        {!social ? (
          <div className="space-y-1.5">
            <Label id={`${id}-type`}>{t("linkType")}</Label>
            <RadioGroup
              aria-labelledby={`${id}-type`}
              className="flex gap-4"
              value={draft.linkType}
              onValueChange={(v) => set({ linkType: v as "page" | "url" })}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="page" /> {t("linkTypePage")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="url" /> {t("linkTypeUrl")}
              </label>
            </RadioGroup>
            {err("/link/type") ? <p role="alert" className="text-sm text-destructive">{err("/link/type")}</p> : null}
          </div>
        ) : null}

        {draft.linkType === "page" && !social ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-page`}>{t("page")}</Label>
            <Select value={pageValue} onValueChange={(v) => set({ pageId: Number(v) })}>
              <SelectTrigger id={`${id}-page`} className="w-full" aria-invalid={Boolean(err("/link/page_id"))}>
                <SelectValue placeholder={t("pagePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.title} ({p.path}){p.status && p.status !== "published" ? ` - ${p.status}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosenPage && chosenPage.status !== "published" ? (
              <Alert role="status">
                <AlertTriangleIcon />
                <AlertDescription>{t("pageNotPublished")}</AlertDescription>
              </Alert>
            ) : null}
            {err("/link/page_id") ? <p role="alert" className="text-sm text-destructive">{err("/link/page_id")}</p> : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-url`}>{t("url")}</Label>
            <Input
              id={`${id}-url`}
              value={draft.url}
              autoComplete="off"
              placeholder={social ? "https://" : "https:// , / , mailto: , tel: , #"}
              aria-invalid={Boolean(err("/link/url"))}
              onChange={(e) => set({ url: e.target.value })}
            />
            <FieldFoot error={err("/link/url")} help={social ? t("urlHelpSocial") : t("urlHelp")} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch id={`${id}-tab`} checked={draft.openInNewTab} onCheckedChange={(v) => set({ openInNewTab: v })} />
          <Label htmlFor={`${id}-tab`} className="font-normal">{t("openInNewTab")}</Label>
        </div>

        {social ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-icon`}>{t("icon")}</Label>
            <Select value={draft.icon} onValueChange={(v) => set({ icon: v })}>
              <SelectTrigger id={`${id}-icon`} className="w-full" aria-invalid={Boolean(err("/icon"))}>
                <SelectValue placeholder={t("iconPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {menu.options.icons.map((icon) => (
                  <SelectItem key={icon} value={icon}>
                    {icon}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err("/icon") ? <p role="alert" className="text-sm text-destructive">{err("/icon")}</p> : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-match`}>{t("activeMatch")}</Label>
          <Select value={draft.activeMatch} onValueChange={(v) => set({ activeMatch: v as "exact" | "prefix" })}>
            <SelectTrigger id={`${id}-match`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefix">{t("matchPrefix")}</SelectItem>
              <SelectItem value="exact">{t("matchExact")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch id={`${id}-visible`} checked={draft.isVisible} onCheckedChange={(v) => set({ isVisible: v })} />
          <Label htmlFor={`${id}-visible`} className="font-normal">{t("visible")}</Label>
        </div>
      </fieldset>

      {warnings.includes("link_page_not_published") ? (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{t("pageNotPublished")}</p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={(item !== null && !dirty) || pending}>
            {pending ? <Spinner /> : <SaveIcon />} {item ? t("save") : t("create")}
          </Button>
          {item ? (
            <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={() => { setDraft(saved); setIssues([]); }}>
              {t("discard")}
            </Button>
          ) : onCancel ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function FieldFoot({ error, help, counter, max }: { error?: string; help?: string; counter?: number; max?: number }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className={cn(error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
        {error ?? help}
      </span>
      {max !== undefined && counter !== undefined ? (
        <span className={cn("shrink-0 text-muted-foreground", counter > max && "text-destructive")}>
          {counter} / {max}
        </span>
      ) : null}
    </div>
  );
}
