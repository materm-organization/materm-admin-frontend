"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useMutationCreatePost } from "@/hooks/use-posts";
import { useCategories } from "@/hooks/use-taxonomy";
import { translateFieldError } from "@/lib/api-error-messages";
import { parseApiError } from "@/lib/api-error";
import { MAX_POST_TITLE, charCount } from "@/lib/posts";
import type { ApiFieldError } from "@/types/api";
import type { CreatePostPayload } from "@/types/posts";

const NONE = "__none__";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; defaultLocale: string };

// SCR-24 "New post" (doc/07 section 3.15, T1.5.5): the title in the default language, an optional category, and the author - the
// person who creates the post (there is no author record in P1, `author_id` is refused by the server). The server makes the slug
// from the title. On success the new draft opens in the editor. One Idempotency-Key per open of the dialog.
export function PostCreateDialog({ open, onOpenChange, defaultLocale }: Props) {
  const t = useTranslations("posts.create");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? <CreateForm onClose={() => onOpenChange(false)} defaultLocale={defaultLocale} open={open} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onClose, defaultLocale, open }: { onClose: () => void; defaultLocale: string; open: boolean }) {
  const t = useTranslations("posts.create");
  const tErr = useTranslations("errors");
  const ui = useLocale();
  const router = useRouter();
  const ids = { title: useId(), category: useId() };
  const { toastError } = useApiErrorHandler();
  const me = useFetchCurrentUser().data?.data;
  const categories = useCategories({ limit: 100 });
  const create = useMutationCreatePost();
  const key = useIdempotencyKey(open);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const rows = (categories.data?.data ?? []).filter((c) => !c.deleted_at && c.is_active);
  const trimmed = title.trim();
  const problem = !trimmed ? "required" : charCount(trimmed) > MAX_POST_TITLE ? "too_long" : null;
  const titleServerError = serverErrors.find((e) => e.path.endsWith("/title"));
  const titleError = titleServerError ? translateFieldError(tErr as never, titleServerError) : submitted && problem ? t(`errors.title.${problem}`, { max: MAX_POST_TITLE }) : null;

  const submit = async () => {
    setSubmitted(true);
    if (problem) return;
    const payload: CreatePostPayload = {
      translations: { [defaultLocale]: { title: trimmed } as CreatePostPayload["translations"][string] },
      ...(categoryId !== NONE ? { category_id: Number(categoryId) } : {}),
    };
    try {
      const result = await create.mutateAsync({ payload, idempotencyKey: key });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/blog/posts/${result.data.data.id}`);
    } catch (error) {
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
    }
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={ids.title}>{t("titleLabel", { locale: defaultLocale.toUpperCase() })}</Label>
        <Input
          id={ids.title}
          value={title}
          autoComplete="off"
          autoFocus
          disabled={create.isPending}
          aria-invalid={Boolean(titleError)}
          onChange={(e) => {
            setTitle(e.target.value);
            setServerErrors([]);
          }}
        />
        {titleError ? <p role="alert" className="text-sm text-destructive">{titleError}</p> : <p className="text-xs text-muted-foreground">{t("titleHint")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.category}>{t("category")}</Label>
        <Select value={categoryId} onValueChange={setCategoryId} disabled={create.isPending}>
          <SelectTrigger id={ids.category} className="w-full">
            <SelectValue placeholder={t("categoryNone")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("categoryNone")}</SelectItem>
            {rows.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.translations[ui]?.name ?? c.translations[defaultLocale]?.name ?? c.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("categoryHint")}</p>
      </div>

      <div className="space-y-1.5">
        <Label>{t("author")}</Label>
        <p className="flex h-9 items-center text-sm" data-testid="post-create-author">
          {me?.name ?? "-"} <span className="ms-1 text-muted-foreground">({t("you")})</span>
        </p>
        <p className="text-xs text-muted-foreground">{t("authorHint")}</p>
      </div>

      {serverErrors.length > 0 && !titleServerError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverErrors.map((e) => translateFieldError(tErr as never, e)).join(" ")}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <PlusIcon />}
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
