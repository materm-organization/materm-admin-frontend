"use client";

import { EyeOffIcon, SaveIcon, Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/global/states/error-state";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { SchemaForm, type SchemaFormHandle } from "@/components/schema-form/schema-form";
import { jsonEqual, useSchemaFormState } from "@/components/schema-form/use-schema-form-state";
import type { SchemaFormValidation } from "@/components/schema-form/use-schema-validation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useAutosave } from "@/hooks/use-autosave";
import { useSectionType } from "@/hooks/use-section-types";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, parseApiError } from "@/lib/api-error";
import type { usePageWrites } from "@/hooks/use-page-sections";
import type { ApiFieldError } from "@/types/api";
import type { Locale } from "@/types/locales";
import type { SectionSummary, UpdateSectionPayload } from "@/types/pages";

export type SectionEditorHandle = {
  // Writes what is edited (one PATCH); true when nothing is left unsaved (also when nothing was pending).
  save: () => Promise<boolean>;
  discard: () => void;
  isDirty: () => boolean;
};

export type SectionEditorState = { dirty: boolean; saving: boolean; blocked: boolean };

// What "Go to field" asks for: a NEW object (token) is a new request; `errors` are shown at the fields (body paths
// `/props/...`), which makes the form switch language, open the array item and focus the field.
export type SectionFocusRequest = { token: number; errors: ApiFieldError[] };

type Props = {
  section: SectionSummary;
  writes: ReturnType<typeof usePageWrites>;
  locales: Locale[];
  locale: string;
  onLocaleChange: (code: string) => void;
  canUpdate: boolean;
  canTranslate: boolean;
  // The page is in the trash.
  readOnly: boolean;
  autosave: boolean;
  focusRequest?: SectionFocusRequest;
  onState: (state: SectionEditorState) => void;
  onIssueCount: (sectionId: number, count: number) => void;
  onConflict: () => void;
};

// Other data a section shows besides its props (doc/07 section 3.13 item 1): a fixed map in the code.
const OTHER_SOURCES = new Set(["blog_strip", "post_list", "contact_section", "faq", "gallery_cards", "photo_story"]);

// SCR-21 (doc/07 sections 3.13 and 4): the props form of one section, its variant, hidden switch and the save. The
// draft (props + variant) is local; "Save section" is ONE `PATCH` with the page's ETag (read when it runs), the answer's
// new ETag goes into the cache. A translator edits only `x-localized` text (the rest is disabled and not sent).
export const SectionEditor = forwardRef<SectionEditorHandle, Props>(function SectionEditor(
  { section, writes, locales, locale, onLocaleChange, canUpdate, canTranslate, readOnly, autosave, focusRequest, onState, onIssueCount, onConflict },
  ref
) {
  const t = useTranslations("pages.editor.section");
  const { toastError } = useApiErrorHandler();
  const typeQuery = useSectionType(section.section_type.key, section.section_type.version);
  const type = typeQuery.data;
  const formHandle = useRef<SchemaFormHandle>(null);

  const translateOnly = !canUpdate && canTranslate;
  const editable = !readOnly && (canUpdate || canTranslate);
  const baseVariant = section.effective_variant ?? section.variant ?? null;

  const form = useSchemaFormState<Record<string, unknown>>(section.props ?? {}, { guard: false });
  const [variant, setVariant] = useState<string | null>(baseVariant);
  const [variantBase, setVariantBase] = useState<string | null>(baseVariant);
  const propsDirty = !jsonEqual(form.value, form.baseline);
  const variantDirty = variant !== variantBase;
  const dirty = propsDirty || variantDirty;

  const [serverErrors, setServerErrors] = useState<ApiFieldError[] | undefined>(focusRequest?.errors);
  const [seenToken, setSeenToken] = useState(focusRequest?.token);
  if (focusRequest && focusRequest.token !== seenToken) {
    setSeenToken(focusRequest.token);
    setServerErrors(focusRequest.errors);
  }
  const [variantError, setVariantError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingVisible, setTogglingVisible] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const inFlight = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ form, variant, variantBase, propsDirty, variantDirty });
  useEffect(() => {
    latest.current = { form, variant, variantBase, propsDirty, variantDirty };
  });

  const doSave = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const { form: f, variant: v, propsDirty: pd, variantDirty: vd } = latest.current;
    if (!pd && !vd) return true;
    const payload: UpdateSectionPayload = {};
    if (pd) payload.props = f.value;
    if (vd && !translateOnly) payload.variant = v;
    const run = (async () => {
      setSaving(true);
      try {
        await writes.updateSection(section.id, payload);
        // Edits made while the PATCH ran stay edits: only the sent value becomes the baseline.
        if (payload.props) f.markSaved(payload.props);
        if ("variant" in payload) setVariantBase(payload.variant ?? null);
        setServerErrors(undefined);
        setVariantError(false);
        onIssueCount(section.id, 0);
        return true;
      } catch (error) {
        if (isConflictError(error)) {
          onConflict();
          return false;
        }
        const parsed = parseApiError(error);
        if (parsed.status === 422 && parsed.fieldErrors.length > 0) {
          setServerErrors(parsed.fieldErrors);
          setVariantError(parsed.fieldErrors.some((e) => e.path === "/variant"));
          onIssueCount(section.id, parsed.fieldErrors.length);
          toast.error(t("saveRefused", { count: parsed.fieldErrors.length }));
        } else {
          toastError(error, t("saveFailed"));
        }
        return false;
      } finally {
        setSaving(false);
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [onConflict, onIssueCount, section.id, t, toastError, translateOnly, writes]);

  const discard = useCallback(() => {
    form.reset();
    setVariant(variantBase);
    setServerErrors(undefined);
    setVariantError(false);
    onIssueCount(section.id, 0);
  }, [form, onIssueCount, section.id, variantBase]);

  useImperativeHandle(ref, () => ({ save: doSave, discard, isDirty: () => latest.current.propsDirty || latest.current.variantDirty }), [discard, doSave]);

  useUnsavedChangesGuard(dirty && editable, { onSave: doSave });
  useEffect(() => {
    onState({ dirty, saving, blocked });
  }, [dirty, saving, blocked, onState]);
  useEffect(() => () => onState({ dirty: false, saving: false, blocked: false }), [onState]);

  const auto = useAutosave({ enabled: autosave && editable, isDirty: dirty, blocked, save: async () => { if (!(await doSave())) throw new Error("not saved"); }, changeToken: form.value });

  const onValidation = useCallback((v: SchemaFormValidation) => setBlocked(v.issues.length > 0), []);

  const setVisible = async (visible: boolean) => {
    setTogglingVisible(true);
    try {
      await writes.updateSection(section.id, { is_visible: visible });
    } catch (error) {
      if (isConflictError(error)) onConflict();
      else toastError(error, t("saveFailed"));
    } finally {
      setTogglingVisible(false);
    }
  };

  if (section.unsupported || (typeQuery.error && parseApiError(typeQuery.error).status === 404)) {
    return (
      <div className="space-y-3" data-testid="unsupported-section">
        <Alert variant="destructive">
          <AlertTitle>{t("unsupported.title")}</AlertTitle>
          <AlertDescription>{t("unsupported.body", { key: section.section_type.key })}</AlertDescription>
        </Alert>
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs" tabIndex={0} aria-label={t("unsupported.props")}>
          {JSON.stringify(section.props ?? {}, null, 2)}
        </pre>
      </div>
    );
  }
  if (typeQuery.error && !type) return <ErrorState error={typeQuery.error} onRetry={() => void typeQuery.refetch()} isRetrying={typeQuery.isFetching} />;
  if (!type || locales.length === 0) return <EditorSkeleton />;

  const variantLabels = (type.ui_schema?.["ui:variant"] ?? {}) as Record<string, string>;
  const sourceKey = OTHER_SOURCES.has(type.key) ? type.key : null;

  return (
    <div className="space-y-4" data-testid="section-editor">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">{type.name}</h2>
          <span className="text-xs text-muted-foreground">{t("version", { version: type.version })}</span>
        </div>
        {type.description ? <p className="text-sm text-muted-foreground">{type.description}</p> : null}
        {sourceKey ? <p className="text-xs text-muted-foreground">{t(`sources.${sourceKey}`)}</p> : null}
      </div>

      {translateOnly ? (
        <Alert>
          <AlertDescription>{t("translateOnly")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        {type.variants.length > 0 ? (
          <fieldset className="space-y-2" disabled={!canUpdate || readOnly}>
            <legend className="mb-1 text-sm font-medium">{t("variant")}</legend>
            <RadioGroup
              value={variant ?? type.variants[0]}
              onValueChange={(next) => {
                setVariant(next);
                setVariantError(false);
              }}
              className="flex flex-wrap gap-4"
              aria-invalid={variantError || undefined}
            >
              {type.variants.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem id={`variant-${section.id}-${value}`} value={value} disabled={!canUpdate || readOnly} />
                  <Label htmlFor={`variant-${section.id}-${value}`} className="font-normal">
                    {variantLabels[value] ?? value}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {variantError ? <p className="text-sm text-destructive">{t("variantInvalid")}</p> : null}
          </fieldset>
        ) : null}
        {canUpdate && !readOnly ? (
          <div className="flex items-center gap-2">
            <Switch
              id={`visible-${section.id}`}
              checked={!section.is_visible}
              disabled={togglingVisible}
              onCheckedChange={(hidden) => void setVisible(!hidden)}
            />
            <Label htmlFor={`visible-${section.id}`} className="font-normal">
              <EyeOffIcon className="size-4" aria-hidden />
              {t("hiddenSwitch")}
            </Label>
          </div>
        ) : null}
      </div>

      <SchemaForm
        ref={formHandle}
        sectionType={type}
        value={form.value}
        onChange={form.setValue}
        locales={locales}
        mode="draft"
        locale={locale}
        onLocaleChange={onLocaleChange}
        serverErrors={serverErrors}
        serverErrorPrefix="/props"
        disabled={!editable}
        translateOnly={translateOnly}
        onValidationChange={onValidation}
      />

      {editable ? (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t bg-background/95 px-1 py-3">
          <Button type="button" variant="outline" size="sm" disabled={!dirty || saving} onClick={discard}>
            <Undo2Icon />
            {t("discard")}
          </Button>
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void doSave()}>
            {saving ? <Spinner /> : <SaveIcon />}
            {t("save")}
          </Button>
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {autosave
              ? auto.status === "scheduled"
                ? t("autosave.scheduled")
                : auto.status === "saving"
                  ? t("autosave.saving")
                  : auto.status === "error"
                    ? t("autosave.error")
                    : auto.lastSavedAt
                      ? t("autosave.saved")
                      : t("autosave.on")
              : dirty
                ? t("unsaved")
                : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
});
