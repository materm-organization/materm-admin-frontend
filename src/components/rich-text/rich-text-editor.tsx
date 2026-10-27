"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  BoldIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { checkLinkUrl, isSafeRichLinkHref, type LinkUrlCheck } from "@/components/schema-form/link-rules";
import {
  countRichTextNodes,
  emptyRichTextDoc,
  isRichTextDoc,
  isRichTextEmpty,
  normalizeRichTextDoc,
  type RichTextDoc,
} from "@/components/schema-form/richtext-doc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

import { buildExtensions, type RichTextProfile } from "./extensions";
import { sanitizePastedHtml } from "./sanitize";

// Rich text as the document JSON of doc/04 section 3.7 (Tiptap / ProseMirror), never HTML. `lite`: paragraph,
// bold, italic, link, lists, line break; `full` adds headings 2-3, block quote and the lead paragraph (images and
// embeds survive a round trip but are inserted by the posts editor). Pasted content is sanitised, the schema
// drops every node / mark outside the allow-list, and links go through the R-016 rule.
//
// `value` is read at mount and again when it changes from OUTSIDE (reset, "copy from default language"); the
// editor never calls `onChange` for that, only for what the user types. An empty document is reported as
// `undefined`, so a cleared field is removed from the props.

export type RichTextEditorProps = {
  value: unknown;
  onChange: (doc: RichTextDoc | undefined) => void;
  profile?: RichTextProfile;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  // Shown as "n / max nodes" (doc/04: lite <= 50 nodes). Informational; the schema enforces the top-level limit.
  maxNodes?: number;
  onBlur?: () => void;
  className?: string;
  "data-field-pointer"?: string;
};

function asDoc(value: unknown): RichTextDoc {
  return isRichTextDoc(value) ? value : emptyRichTextDoc();
}

// Comparison of what the editor holds with what the form holds ("" and an empty paragraph are the same).
function signature(value: unknown): string {
  if (!isRichTextDoc(value) || isRichTextEmpty(value)) return "";
  return JSON.stringify(normalizeRichTextDoc(value));
}

export function RichTextEditor({
  value,
  onChange,
  profile = "lite",
  id,
  disabled = false,
  invalid = false,
  maxNodes,
  onBlur,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "data-field-pointer": fieldPointer,
}: RichTextEditorProps) {
  const t = useTranslations("richText");
  const autoId = useId();
  const editorId = id ?? autoId;
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const lastSignature = useRef(signature(value));
  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
  });
  const extensions = useMemo(() => buildExtensions(profile), [profile]);

  const editor = useEditor({
    extensions,
    content: asDoc(value),
    editable: !disabled,
    // Next.js renders on the server first; Tiptap must not touch the DOM there.
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        id: editorId,
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        ...(invalid ? { "aria-invalid": "true" } : {}),
        class: "rt-content",
      },
      transformPastedHTML: sanitizePastedHtml,
    },
    onUpdate({ editor: e }) {
      const json = e.getJSON() as RichTextDoc;
      const next = isRichTextEmpty(json) ? undefined : normalizeRichTextDoc(json);
      lastSignature.current = next ? JSON.stringify(next) : "";
      onChangeRef.current(next);
    },
    onBlur() {
      onBlurRef.current?.();
    },
  });

  // Outside changes: only when they differ from what the editor already shows.
  useEffect(() => {
    if (!editor) return;
    const incoming = signature(value);
    if (incoming === lastSignature.current) return;
    lastSignature.current = incoming;
    editor.commands.setContent(asDoc(value), { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    // `false`: switching editability must not count as a content update (it would mark the form dirty).
    if (editor && editor.isEditable !== !disabled) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  // aria attributes follow the props (the editor element is created once).
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          id: editorId,
          role: "textbox",
          "aria-multiline": "true",
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
          ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          ...(invalid ? { "aria-invalid": "true" } : {}),
          class: "rt-content",
        },
      },
    });
  }, [editor, editorId, ariaLabel, ariaLabelledBy, ariaDescribedBy, invalid]);

  const nodeCount = editor ? countRichTextNodes(editor.getJSON()) : 0;

  return (
    <div
      data-slot="rich-text-editor"
      data-field-pointer={fieldPointer}
      className={cn(
        "rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        invalid && "border-destructive focus-within:ring-destructive/20",
        disabled && "opacity-60",
        className
      )}
    >
      {!disabled && editor && <Toolbar editor={editor} profile={profile} />}
      <EditorContent editor={editor} className="px-3 py-2 text-sm" />
      {maxNodes !== undefined && (
        <p
          className={cn(
            "border-t px-3 py-1 text-right text-xs text-muted-foreground",
            nodeCount > maxNodes && "text-destructive"
          )}
        >
          {t("nodeCount", { count: nodeCount, max: maxNodes })}
        </p>
      )}
    </div>
  );
}

function Toolbar({ editor, profile }: { editor: Editor; profile: RichTextProfile }) {
  const t = useTranslations("richText");
  const full = profile === "full";
  // Keep the text selection when a toolbar button is pressed.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  const button = (label: string, icon: React.ReactNode, active: boolean, run: () => void, disabled = false) => (
    <Toggle
      type="button"
      size="sm"
      aria-label={label}
      title={label}
      pressed={active}
      disabled={disabled}
      onMouseDown={keepFocus}
      onPressedChange={run}
    >
      {icon}
    </Toggle>
  );

  return (
    <div role="toolbar" aria-label={t("toolbar")} className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      {button(t("paragraph"), <PilcrowIcon />, editor.isActive("paragraph"), () => editor.chain().focus().setParagraph().run())}
      {button(t("bold"), <BoldIcon />, editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
      {button(t("italic"), <ItalicIcon />, editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
      <LinkButton editor={editor} />
      {button(t("bulletList"), <ListIcon />, editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run())}
      {button(t("orderedList"), <ListOrderedIcon />, editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run())}
      {full && (
        <>
          {button(t("heading2"), <Heading2Icon />, editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
          {button(t("heading3"), <Heading3Icon />, editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
          {button(t("blockquote"), <QuoteIcon />, editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run())}
          {button(t("lead"), <span className="text-xs font-semibold">{t("leadShort")}</span>, editor.isActive("lead"), () => editor.chain().focus().toggleLead().run())}
        </>
      )}
    </div>
  );
}

function LinkButton({ editor }: { editor: Editor }) {
  const t = useTranslations("richText");
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const [newTab, setNewTab] = useState(false);
  const [problem, setProblem] = useState<LinkUrlCheck | null>(null);
  const hrefId = useId();
  const tabId = useId();
  const active = editor.isActive("link");

  function onOpenChange(next: boolean) {
    if (next) {
      const attrs = editor.getAttributes("link") as { href?: string | null; target?: string | null };
      setHref(attrs.href ?? "");
      setNewTab(attrs.target === "_blank");
      setProblem(null);
    }
    setOpen(next);
  }

  function apply() {
    const check = checkLinkUrl(href.trim());
    if (!check.ok || !isSafeRichLinkHref(href.trim())) {
      setProblem(check.ok ? { ok: false, reason: "scheme" } : check);
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: href.trim(), target: newTab ? "_blank" : null })
      .run();
    setOpen(false);
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpen(false);
  }

  const reason = problem && !problem.ok ? problem.reason : null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Toggle type="button" size="sm" aria-label={t("link")} title={t("link")} pressed={active} onMouseDown={(e) => e.preventDefault()}>
          <LinkIcon />
        </Toggle>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        <div className="space-y-1.5">
          <Label htmlFor={hrefId}>{t("linkUrl")}</Label>
          <Input
            id={hrefId}
            value={href}
            placeholder="https://, /path, mailto:, tel:, #"
            aria-invalid={reason ? true : undefined}
            aria-describedby={reason ? `${hrefId}-error` : undefined}
            onChange={(e) => {
              setHref(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
          />
          {reason && (
            <p id={`${hrefId}-error`} role="alert" className="text-xs text-destructive">
              {t(`linkProblem.${reason}`)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id={tabId} checked={newTab} onCheckedChange={(v) => setNewTab(v === true)} />
          <Label htmlFor={tabId}>{t("linkNewTab")}</Label>
        </div>
        <div className="flex justify-end gap-2">
          {active && (
            <Button type="button" variant="outline" size="sm" onClick={remove}>
              {t("linkRemove")}
            </Button>
          )}
          <Button type="button" size="sm" onClick={apply}>
            {t("linkApply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
