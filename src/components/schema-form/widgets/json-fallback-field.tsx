"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { useFieldLabel } from "../context";
import type { FieldNode } from "../types";
import { GroupShell } from "./field-shell";

// A schema shape the engine has no widget for: shown as read-only JSON, never dropped from the props.
// A dev-time warning asks for a widget (doc/07 section 4.2, last row).
export function JsonFallbackField({ node, pointer, value }: { node: FieldNode; pointer: string; value: unknown }) {
  const t = useTranslations("schemaForm");
  const label = useFieldLabel(node);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[schema-form] no widget for ${node.schemaPointer || "/"}; shown read-only. Add a widget.`);
    }
  }, [node.schemaPointer]);
  return (
    <GroupShell pointer={pointer} label={label} issues={[]} description={t("unsupportedField")}>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(value ?? null, null, 2)}</pre>
    </GroupShell>
  );
}
