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
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationCreateCollection } from "@/hooks/use-collections";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { MAX_COLLECTION_KEY, MAX_COLLECTION_NAME, collectionKeyProblem, suggestCollectionKey } from "@/lib/collections/constants";
import { generateSchemas } from "@/lib/collections/schema-builder";
import type { ApiFieldError } from "@/types/api";

// "New collection": name, key (suggested from the name until typed; immutable later) and whether entries have an address. It creates the
// definition with NO fields and opens the schema editor, where the fields are built (a `new` route would collide with a real key).
export function CollectionCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("collections.create");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="leading-snug">{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? <Form open={open} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("collections.create");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const ids = { name: useId(), key: useId() };
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateCollection();
  const idempotencyKey = useIdempotencyKey(open);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [hasSlug, setHasSlug] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const trimmed = name.trim();
  const nameProblem = !trimmed ? "required" : [...trimmed].length > MAX_COLLECTION_NAME ? "too_long" : null;
  const keyProblem = collectionKeyProblem(key);
  const serverKey = serverErrors.find((e) => e.path === "/key");
  const serverName = serverErrors.find((e) => e.path === "/name");
  const nameError = serverName ? translateFieldError(tErr as never, serverName) : submitted && nameProblem ? t(`errors.name.${nameProblem}`, { max: MAX_COLLECTION_NAME }) : null;
  const keyError = serverKey ? (serverKey.code === "duplicate" ? t("errors.key.taken") : translateFieldError(tErr as never, serverKey)) : submitted && keyProblem ? t(`errors.key.${keyProblem}`, { min: 3, max: MAX_COLLECTION_KEY }) : null;

  const submit = async () => {
    setSubmitted(true);
    if (nameProblem || keyProblem) return;
    const empty = generateSchemas([]);
    try {
      const result = await create.mutateAsync({
        payload: { key, name: trimmed, has_slug: hasSlug, json_schema: empty.json_schema, localized_schema: empty.localized_schema, ui_schema: empty.ui_schema },
        idempotencyKey,
      });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/collections/${encodeURIComponent(result.data.data.key)}/schema`);
    } catch (error) {
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
    }
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="space-y-1.5">
        <Label htmlFor={ids.name}>{t("nameLabel")}</Label>
        <Input
          id={ids.name}
          value={name}
          autoComplete="off"
          autoFocus
          disabled={create.isPending}
          aria-invalid={Boolean(nameError)}
          onChange={(e) => {
            setName(e.target.value);
            if (!keyTouched) setKey(suggestCollectionKey(e.target.value));
            setServerErrors([]);
          }}
        />
        {nameError ? <p role="alert" className="text-sm text-destructive">{nameError}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.key}>{t("keyLabel")}</Label>
        <Input
          id={ids.key}
          value={key}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          disabled={create.isPending}
          aria-invalid={Boolean(keyError)}
          onChange={(e) => {
            setKey(e.target.value);
            setKeyTouched(true);
            setServerErrors((list) => list.filter((x) => x.path !== "/key"));
          }}
        />
        {keyError ? <p role="alert" className="text-sm text-destructive">{keyError}</p> : <p className="text-xs leading-snug text-muted-foreground">{t("keyHint")}</p>}
      </div>
      <div className="flex items-start gap-3">
        <Switch id="create-has-slug" checked={hasSlug} disabled={create.isPending} onCheckedChange={setHasSlug} />
        <div>
          <Label htmlFor="create-has-slug" className="font-normal">{t("hasSlug")}</Label>
          <p className="text-xs leading-snug text-muted-foreground">{t("hasSlugHint")}</p>
        </div>
      </div>
      {serverErrors.length > 0 && !serverKey && !serverName ? (
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
