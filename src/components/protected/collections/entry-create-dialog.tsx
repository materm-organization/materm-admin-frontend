"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationCreateEntry } from "@/hooks/use-collections";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { ENTRY_SLUG_RE, MAX_ENTRY_SLUG, MAX_ENTRY_TITLE } from "@/lib/collections/constants";
import { slugify } from "@/lib/posts";
import type { ApiFieldError } from "@/types/api";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; collectionKey: string; hasSlug: boolean; defaultLocale: string };

// "New entry": the title (and the address when the collection has one) in the default language. The rest of the entry is filled in the editor,
// which opens on success. One Idempotency-Key per open of the dialog.
export function EntryCreateDialog({ open, onOpenChange, collectionKey, hasSlug, defaultLocale }: Props) {
  const t = useTranslations("collections.entries.create");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="leading-snug">{t("description", { language: defaultLocale.toUpperCase() })}</DialogDescription>
        </DialogHeader>
        {open ? <Form open={open} onClose={() => onOpenChange(false)} collectionKey={collectionKey} hasSlug={hasSlug} defaultLocale={defaultLocale} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ open, onClose, collectionKey, hasSlug, defaultLocale }: Omit<Props, "onOpenChange"> & { onClose: () => void }) {
  const t = useTranslations("collections.entries.create");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const ids = { title: useId(), slug: useId() };
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateEntry(collectionKey);
  const idempotencyKey = useIdempotencyKey(open);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const trimmed = title.trim();
  const titleProblem = !trimmed ? "required" : [...trimmed].length > MAX_ENTRY_TITLE ? "too_long" : null;
  const slugProblem = !hasSlug || slug === "" ? null : slug.length > MAX_ENTRY_SLUG ? "too_long" : ENTRY_SLUG_RE.test(slug) ? null : "pattern_mismatch";
  const base = `/translations/${defaultLocale}`;
  const serverTitle = serverErrors.find((e) => e.path === `${base}/title`);
  const serverSlug = serverErrors.find((e) => e.path === `${base}/slug`);
  const titleError = serverTitle ? translateFieldError(tErr as never, serverTitle) : submitted && titleProblem ? t(`errors.title.${titleProblem}`, { max: MAX_ENTRY_TITLE }) : null;
  const slugError = serverSlug ? (serverSlug.code === "duplicate" ? t("errors.slug.taken") : translateFieldError(tErr as never, serverSlug)) : submitted && slugProblem ? t(`errors.slug.${slugProblem}`, { max: MAX_ENTRY_SLUG }) : null;

  const submit = async () => {
    setSubmitted(true);
    if (titleProblem || slugProblem) return;
    try {
      const result = await create.mutateAsync({
        payload: { translations: { [defaultLocale]: { title: trimmed, ...(hasSlug && slug !== "" ? { slug } : {}) } } },
        idempotencyKey,
      });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/collections/${encodeURIComponent(collectionKey)}/${result.data.data.id}`);
    } catch (error) {
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
    }
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="space-y-1.5">
        <Label htmlFor={ids.title}>{t("titleLabel")}</Label>
        <Input
          id={ids.title}
          value={title}
          autoComplete="off"
          autoFocus
          disabled={create.isPending}
          aria-invalid={Boolean(titleError)}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
            setServerErrors([]);
          }}
        />
        {titleError ? <p role="alert" className="text-sm text-destructive">{titleError}</p> : null}
      </div>
      {hasSlug ? (
        <div className="space-y-1.5">
          <Label htmlFor={ids.slug}>{t("slugLabel")}</Label>
          <Input
            id={ids.slug}
            value={slug}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            disabled={create.isPending}
            aria-invalid={Boolean(slugError)}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
              setServerErrors((list) => list.filter((x) => x.path !== `${base}/slug`));
            }}
          />
          {slugError ? <p role="alert" className="text-sm text-destructive">{slugError}</p> : <p className="text-xs leading-snug text-muted-foreground">{t("slugHint")}</p>}
        </div>
      ) : null}
      {serverErrors.length > 0 && !serverTitle && !serverSlug ? (
        <Alert variant="destructive">
          <AlertDescription>{serverErrors.map((e) => translateFieldError(tErr as never, e)).join(" ")}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>{t("cancel")}</Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <PlusIcon />}
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
