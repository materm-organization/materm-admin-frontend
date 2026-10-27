import { renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import {
  applyFieldErrors,
  firstPointerSegment,
  parsePointer,
  pointerToFieldPath,
} from "@/lib/form-errors";
import type { ApiFieldError } from "@/types/api";

const fe = (path: string, code = "required", where: ApiFieldError["in"] = "body"): ApiFieldError => ({
  in: where,
  path,
  code,
});

describe("pointerToFieldPath (F-7, nested JSON Pointer -> RHF path)", () => {
  it("joins every segment with dots", () => {
    expect(pointerToFieldPath("/items/1/title/la")).toBe("items.1.title.la");
    expect(pointerToFieldPath("/props/hero/cta")).toBe("props.hero.cta");
  });

  it("handles a flat pointer", () => {
    expect(pointerToFieldPath("/new_password")).toBe("new_password");
  });

  it("unescapes ~1 and ~0 (RFC 6901) in that order", () => {
    expect(pointerToFieldPath("/a~1b/c~0d")).toBe("a/b.c~d");
    // "~01" is the literal text "~1", not "/".
    expect(pointerToFieldPath("/x~01y")).toBe("x~1y");
  });

  it("returns undefined when the pointer names no field", () => {
    expect(pointerToFieldPath("")).toBeUndefined();
    expect(pointerToFieldPath("not-a-pointer")).toBeUndefined();
    expect(pointerToFieldPath("/a//b")).toBeUndefined();
    expect(pointerToFieldPath("/")).toBeUndefined();
  });

  it("parsePointer / firstPointerSegment agree with it", () => {
    expect(parsePointer("/grants/3/actions")).toEqual(["grants", "3", "actions"]);
    expect(firstPointerSegment("/grants/3/actions")).toBe("grants");
    expect(firstPointerSegment("")).toBeUndefined();
  });
});

describe("applyFieldErrors", () => {
  function setup(defaultValues: Record<string, unknown>) {
    const { result } = renderHook(() => useForm({ defaultValues }));
    return result.current;
  }

  it("flat mode maps only the first segment (backward compatible)", () => {
    const form = setup({ password: "", grants: [] });
    const applied = applyFieldErrors(
      form,
      [fe("/new_password"), fe("/grants/0/actions"), fe("/nope")],
      (e) => `msg:${e.code}`,
      { new_password: "password" }
    );
    expect(applied).toBe(2);
    expect(form.getFieldState("password").error?.message).toBe("msg:required");
    expect(form.getFieldState("grants").error?.message).toBe("msg:required");
  });

  it("ignores errors that are not in the body", () => {
    const form = setup({ name: "" });
    expect(applyFieldErrors(form, [fe("/name", "required", "query")], () => "x")).toBe(0);
  });

  it("nested mode places the error on the full dotted path and reports it", () => {
    const form = setup({ props: { items: [{ title: { la: "", en: "" } }] } });
    const located = vi.fn();
    const applied = applyFieldErrors(
      form,
      [fe("/props/items/0/title/la", "too_long")],
      (e) => `msg:${e.code}`,
      {},
      { nested: true, onLocatedError: located }
    );
    expect(applied).toBe(1);
    expect(located).toHaveBeenCalledWith("props.items.0.title.la", expect.objectContaining({ code: "too_long" }));
    expect(form.getFieldState("props.items.0.title.la").error?.message).toBe("msg:too_long");
  });

  it("nested mode skips a pointer whose first segment is not a form field", () => {
    const form = setup({ props: {} });
    expect(
      applyFieldErrors(form, [fe("/other/x")], () => "x", {}, { nested: true })
    ).toBe(0);
  });

  it("nested mode renames the head through fieldMap and keeps the tail", () => {
    const form = setup({ content: { title: "" } });
    applyFieldErrors(form, [fe("/props/title")], () => "bad", { props: "content" }, { nested: true });
    expect(form.getFieldState("content.title").error?.message).toBe("bad");
  });

  it("nested mode prefers an exact fieldMap entry for the full path", () => {
    const form = setup({ a: "", b: "" });
    applyFieldErrors(form, [fe("/x/y")], () => "bad", { "x.y": "b", x: "a" }, { nested: true });
    expect(form.getFieldState("b").error?.message).toBe("bad");
    expect(form.getFieldState("a").error).toBeUndefined();
  });
});
