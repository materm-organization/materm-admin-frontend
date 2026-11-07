"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/global/states/error-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useSectionTypes } from "@/hooks/use-section-types";
import { useMutationCreateSharedSection } from "@/hooks/use-shared-sections";
import { parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import type { ApiFieldError } from "@/types/api";

export const MAX_SHARED_NAME = 120;

// "New shared section" (05 18.5): a name, the kind (only the active kinds whose scopes include `shared`) and its variant. The section starts as a draft with the
// kind's example content; the editor opens next.
export function SharedSectionCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("sharedSections.create");
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
  const t = useTranslations("sharedSections.create");
  const tErr = useTranslations("errors");
  const tTypes = useTranslations("publishing.sectionTypes");
  const router = useRouter();
  const nameId = useId();
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateSharedSection();
  const idempotencyKey = useIdempotencyKey(open);
  const types = useSectionTypes({ is_active: true, scope: "shared" }, true);
  const options = useMemo(() => (types.data?.data ?? []).filter((x) => x.is_active && (x.allowed_scopes ?? ["shared"]).includes("shared")), [types.data]);
  const [name, setName] = useState("");
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const trimmed = name.trim();
  const nameProblem = !trimmed ? "required" : [...trimmed].length > MAX_SHARED_NAME ? "too_long" : null;
  const selected = options.find((x) => x.key === typeKey);
  const serverName = serverErrors.find((e) => e.path === "/name");
  const nameError = serverName ? translateFieldError(tErr as never, serverName) : submitted && nameProblem ? t(`errors.name.${nameProblem}`, { max: MAX_SHARED_NAME }) : null;
  const typeError = submitted && !selected ? t("errors.type") : null;
  const other = serverErrors.filter((e) => e.path !== "/name");

  const submit = async () => {
    setSubmitted(true);
    if (nameProblem || !selected) return;
    try {
      const result = await create.mutateAsync({ payload: { name: trimmed, section_type_key: selected.key, ...(variant ? { variant } : {}) }, idempotencyKey });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/sections/${result.data.data.id}`);
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.status === 422 && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
    }
  };

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>{t("nameLabel")}</Label>
        <Input
          id={nameId}
          value={name}
          autoComplete="off"
          autoFocus
          disabled={create.isPending}
          aria-invalid={Boolean(nameError)}
          onChange={(e) => {
            setName(e.target.value);
            setServerErrors([]);
          }}
        />
        {nameError ? <p role="alert" className="text-sm text-destructive">{nameError}</p> : <p className="text-xs leading-snug text-muted-foreground">{t("nameHint")}</p>}
      </div>

      <fieldset className="space-y-2" disabled={create.isPending}>
        <legend className="mb-1 text-sm font-medium">{t("typeLabel")}</legend>
        {types.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : types.error ? (
          <ErrorState error={types.error} onRetry={() => void types.refetch()} isRetrying={types.isFetching} />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTypes")}</p>
        ) : (
          <RadioGroup
            value={typeKey ?? ""}
            onValueChange={(v) => {
              setTypeKey(v);
              setVariant(null);
              setServerErrors([]);
            }}
            className="grid gap-2 sm:grid-cols-2"
            aria-invalid={Boolean(typeError)}
          >
            {options.map((x) => (
              <div key={x.key} className="flex items-start gap-2 rounded-md border p-2">
                <RadioGroupItem id={`shared-type-${x.key}`} value={x.key} className="mt-0.5" />
                <Label htmlFor={`shared-type-${x.key}`} className="flex flex-col items-start gap-0.5 font-normal">
                  <span className="text-sm font-medium">{tTypes.has(x.key) ? tTypes(x.key) : x.name}</span>
                  {x.description ? <span className="text-xs text-muted-foreground">{x.description}</span> : null}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
        {typeError ? <p role="alert" className="text-sm text-destructive">{typeError}</p> : null}
      </fieldset>

      {selected && selected.variants.length > 0 ? (
        <fieldset className="space-y-2" disabled={create.isPending}>
          <legend className="mb-1 text-sm font-medium">{t("variantLabel")}</legend>
          <RadioGroup value={variant ?? "__default"} onValueChange={(v) => setVariant(v === "__default" ? null : v)} className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="shared-variant-default" value="__default" />
              <Label htmlFor="shared-variant-default" className="font-normal">{t("variantDefault")}</Label>
            </div>
            {selected.variants.map((v) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem id={`shared-variant-${v}`} value={v} />
                <Label htmlFor={`shared-variant-${v}`} className="font-normal">{v}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}

      {other.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>{other.map((e) => translateFieldError(tErr as never, e)).join(" ")}</AlertDescription>
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
