import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { NavigationGuardProvider, useNavigationGuardContext } from "@/components/provider/navigation-guard";
import { useSectionType } from "@/hooks/use-section-types";
import { cmsHandlers } from "@/test/cms-handlers";
import { server } from "@/test/msw-server";

import en from "../../../i18n/en.json";
import { SECTION_TYPE_FIXTURES } from "./fixtures";
import { jsonEqual, useSchemaFormState } from "./use-schema-form-state";
import { clearSchemaValidatorCache, createSchemaValidator, getSchemaValidator } from "./validate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/x" }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
      <QueryClientProvider client={client}>
        <NavigationGuardProvider>{children}</NavigationGuardProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("useSectionType", () => {
  it("loads a section type by key (MSW fixtures) and keeps it for the session", async () => {
    server.use(...cmsHandlers);
    const { result } = renderHook(() => useSectionType("hero_brand"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.key).toBe("hero_brand");
    expect(result.current.data?.json_schema.required).toEqual(["title", "background"]);
    expect(result.current.data?.ui_schema["ui:order"]).toBeDefined();
  });

  it("does not fetch without a key, and an unknown key is a 404", async () => {
    server.use(...cmsHandlers);
    const idle = renderHook(() => useSectionType(undefined), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");
    const missing = renderHook(() => useSectionType("nope"), { wrapper });
    await waitFor(() => expect(missing.result.current.isError).toBe(true));
  });
});

describe("useSchemaFormState (unsaved changes)", () => {
  it("is dirty only while the value differs from the saved one; typing and deleting again is clean", () => {
    const { result } = renderHook(() => ({ state: useSchemaFormState({ title: { la: "A" } }), guard: useNavigationGuardContext() }), { wrapper });
    expect(result.current.state.isDirty).toBe(false);
    act(() => result.current.state.setValue({ title: { la: "AB" } }));
    expect(result.current.state.isDirty).toBe(true);
    // the NavigationGuard knows
    expect(result.current.guard.isDirty).toBe(true);
    act(() => result.current.state.setValue({ title: { la: "A" } }));
    expect(result.current.state.isDirty).toBe(false);
    expect(result.current.guard.isDirty).toBe(false);
  });

  it("markSaved makes the current value the baseline; reset throws edits away", () => {
    const { result } = renderHook(() => useSchemaFormState({ n: 1 }), { wrapper });
    act(() => result.current.setValue({ n: 2 }));
    act(() => result.current.markSaved());
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setValue({ n: 3 }));
    act(() => result.current.reset());
    expect(result.current.value).toEqual({ n: 2 });
    expect(result.current.isDirty).toBe(false);
  });

  it("jsonEqual ignores key order and undefined members", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(jsonEqual({ a: {} }, { a: [] })).toBe(false);
  });
});

describe("validator under a CSP without 'unsafe-eval'", () => {
  it("degrades to 'unavailable' instead of throwing (the server still validates)", () => {
    const real = globalThis.Function;
    const refuse = function () {
      throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script");
    } as unknown as FunctionConstructor;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let validator: ReturnType<typeof createSchemaValidator>;
    try {
      globalThis.Function = refuse;
      validator = createSchemaValidator(SECTION_TYPE_FIXTURES.hero_brand.json_schema);
    } finally {
      globalThis.Function = real;
    }
    expect(validator.available).toBe(false);
    expect(validator.unavailable?.reason).toBe("csp");
    expect(validator.validate({}, { mode: "publish", defaultLocale: "la" })).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("compiles once per cache key", () => {
    clearSchemaValidatorCache();
    const a = getSchemaValidator(SECTION_TYPE_FIXTURES.faq.json_schema, "faq@1#");
    const b = getSchemaValidator(SECTION_TYPE_FIXTURES.faq.json_schema, "faq@1#");
    expect(a).toBe(b);
    expect(getSchemaValidator(SECTION_TYPE_FIXTURES.faq.json_schema, "faq@2#")).not.toBe(a);
  });
});
