"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { locateSchemaError } from "@/lib/collections/schema-errors";
import type { SchemaProblem } from "@/components/protected/collections/definition-draft";
import type { ApiFieldError } from "@/types/api";

// Readable text for one schema error of the server (05 17.4.5) or of the client check: the code (and for `invalid_schema` the reason) names the
// problem, the path says where. `params.detail` of `compile` / `pattern` is the compiler's English text and is shown as plain text.
export function useSchemaErrorText() {
  const t = useTranslations("collections.schemaErrors");
  const tDoc = useTranslations("collections.documents");
  return (error: { path: string; code: string; params?: Record<string, unknown> }, prefix = true): string => {
    const located = locateSchemaError({ in: "body", ...error } as ApiFieldError);
    const params = (error.params ?? {}) as Record<string, string | number>;
    const reason = typeof params.reason === "string" ? params.reason : "";
    const keyed = error.code === "invalid_schema" ? `invalid_schema.${reason}` : error.code === "limit_exceeded" ? `limit_exceeded.${typeof params.limit === "string" ? params.limit : "other"}` : error.code;
    const values = { ...params, keyword: String(params.keyword ?? ""), name: String(params.name ?? ""), detail: String(params.detail ?? ""), max: Number(params.max ?? 0) };
    const text = t.has(keyed) ? t(keyed, values) : t.has(error.code) && error.code !== "invalid_schema" ? t(error.code, values) : t("other", { code: error.code });
    const detail = (error.code === "invalid_schema" && (reason === "compile" || reason === "pattern") && params.detail) || "";
    const where = located ? [located.field ? t("inField", { field: located.field }) : tDoc(located.schema), located.rest.length ? located.rest.join(" › ") : ""].filter(Boolean).join(": ") : "";
    return [prefix && where ? `${where} - ` : "", text, detail ? ` (${detail})` : ""].join("");
  };
}

export function SchemaErrorList({ errors, problems = [] }: { errors: ApiFieldError[]; problems?: SchemaProblem[] }) {
  const t = useTranslations("collections.schemaErrors");
  const tDoc = useTranslations("collections.documents");
  const describe = useSchemaErrorText();
  const lines: string[] = [];
  for (const e of errors) lines.push(describe(e));
  for (const p of problems) {
    if (p.kind === "json") lines.push(t("badJson", { document: tDoc(p.document), message: p.message }));
    else if (p.kind === "fields") lines.push(t("fieldsToFix", { count: p.count }));
    else lines.push(`${tDoc(p.document)}${p.issue.path ? ` ${p.issue.path}` : ""} - ${describe({ ...p.issue, path: `/${p.document}${p.issue.path}` }, false)}`);
  }
  if (lines.length === 0) return null;
  return (
    <Alert variant="destructive" role="alert" data-testid="schema-errors">
      <AlertTitle>{t("title", { count: lines.length })}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-5 leading-snug">
          {lines.map((l, i) => (
            <li key={`${i}-${l}`} className="break-words">
              {l}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
