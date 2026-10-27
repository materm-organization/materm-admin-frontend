"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { memo, useCallback } from "react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { isShown } from "../compile-field-tree";
import { joinPointer } from "../pointer";
import { useFieldLabel, useIssuesAt, useIssuesUnder, useSchemaFormContext } from "../context";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { ArrayField } from "./array-field";
import { EntityField } from "./entity-field";
import { GroupShell } from "./field-shell";
import { JsonFallbackField } from "./json-fallback-field";
import { LinkField } from "./link-field";
import { LocalizedTextField } from "./localized-text-field";
import { MediaField } from "./media-field";
import { RichTextField } from "./rich-text-field";
import { BooleanField, EnumArrayField, EnumField, NumberField, StringField } from "./scalar-fields";

// Chooses the widget for a node (doc/07 section 4.2 / 4.3). Memoised on (node, pointer, value): an edit copies
// only the objects along its path (`setByPointer`), so every untouched branch keeps its value identity and
// skips rendering.
export const FieldRenderer = memo(function FieldRenderer({
  node,
  pointer,
  value,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
}) {
  const { setAt, disabled, translateOnly } = useSchemaFormContext();
  const onChange = useCallback((next: unknown) => setAt(pointer, next), [setAt, pointer]);
  const translatable = node.kind === "localized-text" || node.kind === "richtext";
  const editable = !disabled && (!translateOnly || translatable);
  const props = { node, pointer, value, onChange, editable };

  switch (node.kind) {
    case "localized-text":
      return <LocalizedTextField {...props} />;
    case "richtext":
      return <RichTextField {...props} />;
    case "image":
      return <MediaField {...props} altEditable={!disabled} />;
    case "link":
      return <LinkField {...props} />;
    case "entity":
      return <EntityField {...props} />;
    case "object":
      return <ObjectField {...props} />;
    case "array":
      return <ArrayField {...props} />;
    case "enum":
      return <EnumField {...props} />;
    case "enum-array":
      return <EnumArrayField {...props} />;
    case "boolean":
      return <BooleanField {...props} />;
    case "number":
      return <NumberField {...props} />;
    case "string":
      return <StringField {...props} />;
    default:
      return <JsonFallbackField node={node} pointer={pointer} value={value} />;
  }
});

// The fields of an object, in `ui:order`. A field hidden by `ui:showIf` keeps its value (it is not deleted);
// when it holds validation problems they are surfaced here, with a button to clear the hidden data
// (doc/07 section 4.3).
export function ObjectChildren({ node, pointer, value }: { node: FieldNode; pointer: string; value: unknown }) {
  const object = isPlainObject(value) ? value : {};
  return (
    <div className="space-y-4">
      {node.children.map((child) => {
        const childPointer = joinPointer(pointer, child.name);
        return isShown(child, object) ? (
          <FieldRenderer key={child.name} node={child} pointer={childPointer} value={object[child.name]} />
        ) : (
          <HiddenIssues key={child.name} node={child} pointer={childPointer} />
        );
      })}
    </div>
  );
}

function HiddenIssues({ node, pointer }: { node: FieldNode; pointer: string }) {
  const t = useTranslations("schemaForm");
  const { setAt, disabled } = useSchemaFormContext();
  const label = useFieldLabel(node);
  const issues = useIssuesUnder(pointer);
  if (issues.length === 0) return null;
  return (
    <Alert variant="destructive" data-slot="hidden-issues">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{t("hiddenHasIssues", { field: label, count: issues.length })}</span>
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAt(pointer, undefined)}>
            {t("clearHidden")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ObjectField({
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
  const t = useTranslations("schemaForm");
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const isRoot = pointer === "";

  if (isRoot) return <ObjectChildren node={node} pointer={pointer} value={value} />;

  // An optional group (a CTA button, a caption) exists or does not.
  if (node.optionalGroup && value === undefined) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3" data-field-pointer={pointer}>
        <div>
          <p className="text-sm font-medium">{label}</p>
          {node.description && <p className="text-xs text-muted-foreground">{node.description}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!editable} onClick={() => onChange({})}>
          <PlusIcon />
          {t("addGroup", { name: label })}
        </Button>
      </div>
    );
  }

  return (
    <GroupShell
      pointer={pointer}
      label={label}
      required={node.required}
      description={node.description}
      issues={issues}
      actions={
        node.optionalGroup && editable ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onChange(undefined)}>
            <Trash2Icon className="size-3.5" />
            {t("removeGroup", { name: label })}
          </Button>
        ) : null
      }
    >
      <ObjectChildren node={node} pointer={pointer} value={value} />
    </GroupShell>
  );
}
