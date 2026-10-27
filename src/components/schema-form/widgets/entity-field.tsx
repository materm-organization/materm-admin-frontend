"use client";

import { TriangleAlertIcon } from "lucide-react";

import { useFieldLabel, useIssuesAt, useSchemaFormContext } from "../context";
import { getByPointer } from "../pointer";
import type { FieldNode } from "../types";
import { EntityPicker, useEntityWarning } from "./entity-picker";
import { FieldShell } from "./field-shell";

// An `x-ref` field (doc/07 section 4.3): the id of a post / album / category / album item, or the key / slug of
// a FAQ group / form, chosen with the async EntityPicker.
export function EntityField({
  node,
  pointer,
  value,
  onChange,
  editable,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
}) {
  const { rootValue } = useSchemaFormContext();
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const entity = node.entity;
  const albumField = node.options.albumField;
  const albumValue = albumField ? getByPointer(rootValue, albumField) : undefined;
  const albumId = typeof albumValue === "number" ? albumValue : undefined;
  const typed = entity?.valueType === "string" ? (typeof value === "string" ? value : undefined) : typeof value === "number" ? value : undefined;
  const warning = useEntityWarning(entity?.kind ?? "post", typed, albumId);
  if (!entity) return null;

  return (
    <FieldShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues}>
      {(a11y) => (
        <>
          <EntityPicker
            kind={entity.kind}
            {...a11y}
            aria-label={label}
            value={typed}
            disabled={!editable}
            albumId={albumId}
            onChange={(next) => onChange(next === undefined ? undefined : entity.valueType === "number" ? Number(next) : String(next))}
          />
          {warning && (
            <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </p>
          )}
        </>
      )}
    </FieldShell>
  );
}
