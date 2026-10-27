import { act, screen, within } from "@testing-library/react";
import { useState } from "react";
import { expect } from "vitest";

import type { SectionType } from "@/types/cms";
import type { Locale } from "@/types/locales";
import { renderApp } from "@/test/render-app";

import { LOCALE_ROWS } from "./fixtures/lookup";
import { SchemaForm, type SchemaFormHandle, type SchemaFormProps } from "./schema-form";

import { createRef, type Ref } from "react";

// Shared helpers of the schema form tests: full Locale rows from the seed, and a stateful host so edits flow back
// into `value` the way the editor page does it.
export const LOCALES: Locale[] = LOCALE_ROWS;

export type HostOptions = Partial<Omit<SchemaFormProps, "sectionType" | "value" | "onChange">> & {
  onChange?: (value: Record<string, unknown>) => void;
};

export function Host({
  type,
  initial,
  options = {},
  formRef,
}: {
  type: Pick<SectionType, "key" | "version" | "json_schema" | "ui_schema" | "schema_hash">;
  initial: Record<string, unknown>;
  options?: HostOptions;
  formRef?: Ref<SchemaFormHandle>;
}) {
  const [value, setValue] = useState(initial);
  const { onChange, ...rest } = options;
  return (
    <SchemaForm
      ref={formRef}
      sectionType={type}
      value={value}
      locales={LOCALES}
      validationDelayMs={0}
      {...rest}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

export function renderSchemaForm(
  type: Pick<SectionType, "key" | "version" | "json_schema" | "ui_schema" | "schema_hash">,
  initial: Record<string, unknown>,
  options: HostOptions = {}
) {
  const formRef = createRef<SchemaFormHandle>();
  const result = renderApp(<Host type={type} initial={initial} options={options} formRef={formRef} />);
  return { ...result, formRef };
}

export function issueTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-slot="field-issue"]')).map((el) => el.textContent ?? "");
}

export async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

export { screen, within, expect };
