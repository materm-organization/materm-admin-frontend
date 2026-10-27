"use client";

import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { EditorLocaleSwitcher } from "@/components/global/locale/editor-locale-switcher";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ApiFieldError } from "@/types/api";
import type { SectionType } from "@/types/cms";
import type { Locale } from "@/types/locales";

import { compileFieldTree } from "./compile-field-tree";
import { SchemaFormContextProvider, useIssueTranslator, type SchemaFormContextValue } from "./context";
import { groupIssuesByPointer, countIssuesByLocale, locateIssue, serverErrorsToIssues } from "./issues";
import { getByPointer, setByPointer } from "./pointer";
import { useSchemaValidation, type SchemaFormValidation } from "./use-schema-validation";
import type { Issue, ValidationMode } from "./types";
import type { MediaLookup } from "./validate";
import { FieldRenderer } from "./widgets/field-renderer";
import type { CompletenessOptions } from "./completeness";

// Renders the props form of one section from its `json_schema` + `ui_schema` (doc/07 section 4). The props
// object IS the form state: controlled `value` / `onChange`, edits are immutable path writes, a cleared field is
// removed. Validation (Ajv, draft or publish) and server `errors[]` are shown per field; the language is chosen
// at the editor level.
//
//   <SchemaForm sectionType={type} value={props} onChange={setProps} locales={locales} mode="draft"
//               serverErrors={errors} />
//
// The editor page owns: loading (`useSectionType`, `useLocales`), saving (PATCH + If-Match), the unsaved-changes
// guard (`useSchemaFormState`), autosave (`useAutosave`) and the `?locale=` URL (`locale` / `onLocaleChange`).

export type SchemaFormHandle = {
  // Moves focus to the first field with a problem (switching language / opening its array item when needed).
  focusFirstIssue: () => boolean;
  // Everything currently shown (client + server).
  getIssues: () => Issue[];
};

export type SchemaFormProps = {
  sectionType: Pick<SectionType, "key" | "version" | "json_schema" | "ui_schema" | "schema_hash">;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  // All languages of `GET /locales`; the inactive ones are not offered (their stored text is kept).
  locales: Locale[];
  // draft: required / minLength are not enforced; publish: everything + the default language is required.
  mode?: ValidationMode;
  // Controlled language (e.g. the `?locale=` search param); uncontrolled when omitted.
  locale?: string;
  onLocaleChange?: (code: string) => void;
  // Body errors of a 422 (`errors[]` with JSON-Pointer paths into the props). CONTRACT: pass the array of the
  // failed save UNCHANGED (keep it in state); a new array INSTANCE means a new batch - it replaces the previous
  // set, switches language, opens the item and focuses the field. Never build it inline on every render.
  // An error disappears when its field changes.
  serverErrors?: ApiFieldError[];
  // Pointer prefix of the props inside the server's body (`/props` for `PATCH …/sections`).
  serverErrorPrefix?: string;
  disabled?: boolean;
  // A translator edits only the localized text of an existing section (doc/07 section 2.5.9).
  translateOnly?: boolean;
  validationDelayMs?: number;
  // Media rows for the publish checks and the alt completeness (BR-14); unknown ids are skipped.
  media?: MediaLookup;
  mediaAlt?: CompletenessOptions["media"];
  onValidationChange?: (validation: SchemaFormValidation) => void;
  className?: string;
};

export const SchemaForm = forwardRef<SchemaFormHandle, SchemaFormProps>(function SchemaForm(
  {
    sectionType,
    value,
    onChange,
    locales,
    mode = "draft",
    locale: controlledLocale,
    onLocaleChange,
    serverErrors,
    serverErrorPrefix = "",
    disabled = false,
    translateOnly = false,
    validationDelayMs = 300,
    media,
    mediaAlt,
    onValidationChange,
    className,
  },
  ref
) {
  const t = useTranslations("schemaForm");
  const formId = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const translateIssue = useIssueTranslator();

  const tree = useMemo(
    () => compileFieldTree(sectionType.json_schema, sectionType.ui_schema),
    [sectionType.json_schema, sectionType.ui_schema]
  );
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") for (const w of tree.warnings) console.warn(`[schema-form] ${sectionType.key} ${w}`);
  }, [tree, sectionType.key]);

  const activeLocales = useMemo(() => locales.filter((l) => l.is_active), [locales]);
  const defaultLocale = (locales.find((l) => l.is_default) ?? activeLocales[0])?.code ?? "";

  // ---- language -----------------------------------------------------------------------------------------------
  const [innerLocale, setInnerLocale] = useState(defaultLocale);
  const requested = controlledLocale ?? innerLocale;
  const locale = activeLocales.some((l) => l.code === requested) ? requested : defaultLocale;
  const setLocale = useCallback(
    (code: string) => {
      setInnerLocale(code);
      onLocaleChange?.(code);
    },
    [onLocaleChange]
  );
  const [compare, setCompare] = useState(false);

  // ---- value writes -------------------------------------------------------------------------------------------
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const setAt = useCallback((pointer: string, next: unknown) => {
    const updated = (pointer === "" ? next : setByPointer(latest.current, pointer, next)) as Record<string, unknown>;
    latest.current = updated;
    onChangeRef.current(updated);
  }, []);

  // ---- validation ---------------------------------------------------------------------------------------------
  const validation = useSchemaValidation(sectionType, value, {
    mode,
    defaultLocale,
    localeCodes: activeLocales.map((l) => l.code),
    delayMs: validationDelayMs,
    media,
    mediaAlt,
  });
  // Reported only when the CONTENT of the result changes (a caller's inline `media` lookup or `setState` in the
  // callback must not be able to loop): the issues, the completeness numbers and whether Ajv is available.
  const validationSignature = useMemo(
    () =>
      JSON.stringify([
        validation.validatorAvailable,
        validation.issues.map((i) => `${i.path} ${i.code}`).sort(),
        Object.entries(validation.completeness).map(([code, c]) => [code, c.filled, c.total]),
      ]),
    [validation]
  );
  const reported = useRef<string | null>(null);
  const onValidationChangeRef = useRef(onValidationChange);
  useEffect(() => {
    onValidationChangeRef.current = onValidationChange;
  });
  useEffect(() => {
    if (reported.current === validationSignature) return;
    reported.current = validationSignature;
    onValidationChangeRef.current?.(validation);
    // `validation` itself is not a dependency on purpose: only its signature decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationSignature]);

  // Server issues: set when a new batch arrives, dropped as soon as their field's value changes.
  const [serverIssues, setServerIssues] = useState<Issue[]>(() => serverErrorsToIssues(serverErrors, serverErrorPrefix));
  const [batch, setBatch] = useState(serverErrors);
  if (serverErrors !== batch) {
    setBatch(serverErrors);
    setServerIssues(serverErrorsToIssues(serverErrors, serverErrorPrefix));
  }
  const previousValue = useRef(value);
  useEffect(() => {
    const before = previousValue.current;
    previousValue.current = value;
    if (before === value) return;
    setServerIssues((current) => {
      const kept = current.filter((issue) => getByPointer(before, issue.path) === getByPointer(value, issue.path));
      return kept.length === current.length ? current : kept;
    });
  }, [value]);

  const allIssues = useMemo(() => [...validation.issues, ...serverIssues], [validation.issues, serverIssues]);
  const issueMap = useMemo(() => groupIssuesByPointer(allIssues), [allIssues]);
  const counts = useMemo(() => countIssuesByLocale(tree, allIssues), [tree, allIssues]);

  // ---- focus / reveal -----------------------------------------------------------------------------------------
  const [reveal, setReveal] = useState<{ pointer: string; token: number } | null>(null);
  const revealToken = useRef(0);

  const focusDom = useCallback(() => {
    const root = rootRef.current;
    if (!root) return false;
    const target =
      root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      root.querySelector<HTMLElement>('[data-slot="field-issue"]');
    if (!target) return false;
    const focusable = target.matches("input,textarea,select,button,[contenteditable],[tabindex]")
      ? target
      : (target.querySelector<HTMLElement>("input,textarea,select,button,[contenteditable]") ?? target);
    focusable.scrollIntoView?.({ block: "center" });
    focusable.focus({ preventScroll: true });
    return true;
  }, []);

  const focusFirstIssue = useCallback(() => {
    const first = allIssues[0];
    if (!first) return false;
    const location = locateIssue(tree, first.path);
    if (location.locale && location.locale !== locale && activeLocales.some((l) => l.code === location.locale)) {
      setLocale(location.locale);
    }
    revealToken.current += 1;
    setReveal({ pointer: first.path, token: revealToken.current });
    // The language switch and the opened array item render first; then focus.
    requestAnimationFrame(() => requestAnimationFrame(() => focusDom()));
    return true;
  }, [activeLocales, allIssues, focusDom, locale, setLocale, tree]);

  const focusRef = useRef(focusFirstIssue);
  useEffect(() => {
    focusRef.current = focusFirstIssue;
  });
  // A new batch of server errors takes the user to the first problem.
  useEffect(() => {
    if (serverIssues.length > 0) focusRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch]);

  useImperativeHandle(ref, () => ({ focusFirstIssue, getIssues: () => allIssues }), [focusFirstIssue, allIssues]);

  const context = useMemo<SchemaFormContextValue>(
    () => ({
      formId,
      typeKey: sectionType.key,
      rootSchema: sectionType.json_schema,
      mode,
      locale,
      defaultLocale,
      locales: activeLocales,
      compare,
      disabled,
      translateOnly,
      issues: issueMap,
      rootValue: value,
      setAt,
      reveal,
      translateIssue,
    }),
    [formId, sectionType.key, sectionType.json_schema, mode, locale, defaultLocale, activeLocales, compare, disabled, translateOnly, issueMap, value, setAt, reveal, translateIssue]
  );

  // Languages not loaded yet: there is no default language to write into (the first keystroke would store a
  // `""` locale key). The page should wait for `useLocales()`; this keeps a premature render harmless.
  if (!defaultLocale) return <EditorSkeleton />;

  const current = validation.completeness[locale];
  const badges = Object.fromEntries(
    Object.entries(validation.completeness).map(([code, c]) => [code, { missing: c.missing.length, total: c.total, status: c.status }])
  );

  return (
    <SchemaFormContextProvider value={context}>
      <div ref={rootRef} className={className} data-slot="schema-form" data-mode={mode}>
        <div className="mb-4 space-y-3">
          {activeLocales.length > 1 && (
            <EditorLocaleSwitcher
              locales={activeLocales}
              value={locale}
              onChange={setLocale}
              completeness={badges}
              issueCounts={counts.byLocale}
              compare={compare}
              onCompareChange={setCompare}
            />
          )}
          {current && current.total > 0 && (
            <div className="flex items-center gap-3" data-slot="completeness">
              <Progress value={current.percent} className="h-1.5 max-w-48" aria-label={t("completenessLabel", { locale: locale.toUpperCase() })} />
              <p className="text-xs text-muted-foreground">
                {t("completeness", { percent: current.percent, filled: current.filled, total: current.total, locale: locale.toUpperCase() })}
              </p>
            </div>
          )}
          {!validation.validatorAvailable && (
            <Alert data-slot="validator-unavailable">
              <AlertDescription>{t("validatorUnavailable")}</AlertDescription>
            </Alert>
          )}
          {allIssues.length > 0 && (
            <Alert variant="destructive" data-slot="issue-summary">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{t("issueSummary", { count: allIssues.length })}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => focusFirstIssue()}>
                  {t("goToFirst")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
        <FieldRenderer node={tree.root} pointer="" value={value} />
      </div>
    </SchemaFormContextProvider>
  );
});
