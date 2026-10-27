"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import type { ApiFieldError } from "@/types/api";

import { SchemaFormDataProvider } from "../data/provider";
import { memorySchemaFormData } from "../data/memory-data";
import { EXAMPLE_SECTIONS, SECTION_TYPE_FIXTURES, SECTION_TYPE_KEYS } from "../fixtures";
import { LOCALE_ROWS } from "../fixtures/lookup";
import { SchemaForm, type SchemaFormHandle } from "../schema-form";
import { useSchemaFormState } from "../use-schema-form-state";
import type { SchemaFormValidation } from "../use-schema-validation";
import type { ValidationMode } from "../types";

// Developer playground (English only on purpose: it is not product UI). Everything the engine does can be tried
// here against the 12 section types and the 17 example sections, with in-memory pickers.
export function SchemaFormPlayground() {
  const [typeKey, setTypeKey] = useState("hero_brand");
  return <Playground key={typeKey} typeKey={typeKey} onTypeChange={setTypeKey} />;
}

function Playground({ typeKey, onTypeChange }: { typeKey: string; onTypeChange: (key: string) => void }) {
  const type = SECTION_TYPE_FIXTURES[typeKey];
  const examples = useMemo(() => EXAMPLE_SECTIONS.filter((e) => e.section_type === typeKey), [typeKey]);
  const [source, setSource] = useState("default");
  const initial = useMemo(
    () =>
      structuredClone(
        source === "default" ? type.default_props : (examples[Number(source)]?.props ?? type.default_props)
      ) as Record<string, unknown>,
    [source, type, examples]
  );
  return <PlaygroundBody key={source} typeKey={typeKey} onTypeChange={onTypeChange} initial={initial} source={source} onSourceChange={setSource} examples={examples.length} />;
}

function PlaygroundBody({
  typeKey,
  onTypeChange,
  initial,
  source,
  onSourceChange,
  examples,
}: {
  typeKey: string;
  onTypeChange: (key: string) => void;
  initial: Record<string, unknown>;
  source: string;
  onSourceChange: (source: string) => void;
  examples: number;
}) {
  const type = SECTION_TYPE_FIXTURES[typeKey];
  const formRef = useRef<SchemaFormHandle>(null);
  const [mode, setMode] = useState<ValidationMode>("draft");
  const [disabled, setDisabled] = useState(false);
  const [translateOnly, setTranslateOnly] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [serverText, setServerText] = useState('[\n  { "in": "body", "path": "/title/en", "code": "too_long", "params": { "max": 80 } }\n]');
  const [serverErrors, setServerErrors] = useState<ApiFieldError[] | undefined>();
  const [serverParseError, setServerParseError] = useState<string | null>(null);
  const [validation, setValidation] = useState<SchemaFormValidation | null>(null);
  const [saves, setSaves] = useState(0);
  const [locale, setLocale] = useState(() => {
    if (typeof window === "undefined") return undefined;
    return new URLSearchParams(window.location.search).get("locale") ?? undefined;
  });

  const state = useSchemaFormState(initial);
  const { markSaved } = state;
  // A pretend PATCH: the real editor sends the props with If-Match and takes the new ETag from the answer.
  const save = useCallback(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    setSaves((n) => n + 1);
    markSaved();
  }, [markSaved]);
  const blocked = (validation?.issues.length ?? 0) > 0 && mode === "draft";
  const auto = useAutosave({ enabled: autosave, isDirty: state.isDirty, blocked, save });

  const onLocaleChange = (code: string) => {
    setLocale(code);
    const url = new URL(window.location.href);
    url.searchParams.set("locale", code);
    window.history.replaceState(null, "", url);
  };

  const applyServerErrors = () => {
    try {
      const parsed = JSON.parse(serverText);
      if (!Array.isArray(parsed)) throw new Error("must be an array");
      setServerParseError(null);
      setServerErrors(parsed as ApiFieldError[]);
    } catch (error) {
      setServerParseError(String(error));
    }
  };

  return (
    <SchemaFormDataProvider data={memorySchemaFormData}>
      <div className="space-y-4" data-testid="playground">
        <div>
          <h1 className="text-2xl font-semibold tracking-wide">Schema form playground</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Development only (404 in production). Section type {type.key} v{type.version}: {type.description}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="pg-type">Section type</Label>
            <select id="pg-type" className="h-9 rounded-md border bg-background px-2 text-sm" value={typeKey} onChange={(e) => onTypeChange(e.target.value)}>
              {SECTION_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-source">Start from</Label>
            <select id="pg-source" className="h-9 rounded-md border bg-background px-2 text-sm" value={source} onChange={(e) => onSourceChange(e.target.value)}>
              <option value="default">default_props</option>
              {Array.from({ length: examples }, (_, i) => (
                <option key={i} value={String(i)}>example {i + 1}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-mode">Validation</Label>
            <select id="pg-mode" className="h-9 rounded-md border bg-background px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as ValidationMode)}>
              <option value="draft">draft (save)</option>
              <option value="publish">publish (pre-check)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={disabled} onCheckedChange={setDisabled} aria-label="Read only" />Read only</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={translateOnly} onCheckedChange={setTranslateOnly} aria-label="Translate only" />Translate only</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={autosave} onCheckedChange={setAutosave} aria-label="Autosave" />Autosave (30 s)</label>
          <Button type="button" size="sm" disabled={!state.isDirty} onClick={() => void save()}>Save</Button>
          <Button type="button" size="sm" variant="outline" disabled={!state.isDirty} onClick={() => state.reset()}>Discard</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => formRef.current?.focusFirstIssue()}>Focus first problem</Button>
          <p className="text-xs text-muted-foreground" data-testid="status">
            {state.isDirty ? "unsaved changes" : "saved"} · saves: {saves} · autosave: {autosave ? auto.status : "off"}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <SchemaForm
            ref={formRef}
            sectionType={type}
            value={state.value}
            onChange={state.setValue}
            locales={LOCALE_ROWS}
            mode={mode}
            locale={locale}
            onLocaleChange={onLocaleChange}
            disabled={disabled}
            translateOnly={translateOnly}
            serverErrors={serverErrors}
            onValidationChange={setValidation}
            className="min-w-0"
          />
          <aside className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pg-server">Server errors (422 body errors[])</Label>
              <Textarea id="pg-server" rows={6} className="font-mono text-xs" value={serverText} onChange={(e) => setServerText(e.target.value)} />
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={applyServerErrors}>Apply</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setServerErrors(undefined)}>Clear</Button>
              </div>
              {serverParseError && <Alert variant="destructive"><AlertDescription>{serverParseError}</AlertDescription></Alert>}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Completeness</p>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs" data-testid="completeness">
                {JSON.stringify(Object.fromEntries(Object.entries(validation?.completeness ?? {}).map(([k, v]) => [k, `${v.percent}% (${v.filled}/${v.total}) ${v.status}`])), null, 2)}
              </pre>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Issues ({validation?.issues.length ?? 0}, {mode})</p>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs" data-testid="issues">
                {JSON.stringify(validation?.issues.map((i) => `${i.path || "/"} ${i.code}`) ?? [], null, 2)}
              </pre>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Props (what would be saved)</p>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-2 text-xs" data-testid="props">{JSON.stringify(state.value, null, 2)}</pre>
            </div>
          </aside>
        </div>
      </div>
    </SchemaFormDataProvider>
  );
}
