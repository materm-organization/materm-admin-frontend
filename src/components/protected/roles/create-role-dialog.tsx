"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldPlusIcon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useMutationCreateRole, useRoles } from "@/hooks/use-roles";

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;
const NO_COPY = "__none__";

function createRoleSchema(t: (key: string) => string) {
  return z.object({
    role_key: z.string().trim().regex(ROLE_KEY_PATTERN, t("validation.roleKeyInvalid")),
    name: z.string().trim().min(1, t("validation.nameRequired")).max(80, t("validation.nameTooLong")),
    description: z.string().trim().max(500, t("validation.descriptionTooLong")),
    copy_from: z.string(),
    sort_order: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, t("validation.sortOrderInvalid"))
      .refine((v) => Number(v) >= 0 && Number(v) <= 1000, t("validation.sortOrderInvalid")),
  });
}
type CreateRoleValues = z.infer<ReturnType<typeof createRoleSchema>>;

// SCR-09 "Create role": key (immutable), name, description, optional "copy permissions from role X", sort
// order. `Idempotency-Key` once per open. On success it goes to the new role's matrix (SCR-10).
export function CreateRoleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("roles.create");
  const router = useRouter();
  const mutation = useMutationCreateRole();
  const roles = useRoles(open);
  const { handleFormError } = useApiErrorHandler();
  const idempotencyKey = useIdempotencyKey(open);

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema(t)),
    defaultValues: { role_key: "", name: "", description: "", copy_from: NO_COPY, sort_order: "100" },
  });

  const handleOpenChange = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) form.reset();
    onOpenChange(next);
  };

  const onSubmit = (values: CreateRoleValues) => {
    mutation.mutate(
      {
        payload: {
          role_key: values.role_key,
          name: values.name,
          description: values.description,
          sort_order: Number(values.sort_order),
          ...(values.copy_from !== NO_COPY ? { copy_from_role_id: Number(values.copy_from) } : {}),
        },
        idempotencyKey,
      },
      {
        onSuccess: (res) => {
          form.reset();
          onOpenChange(false);
          toast.success(t("toast.success"));
          router.push(`/admin/roles/${res.data.data.id}`);
        },
        // 409 CONFLICT_DUPLICATE `/role_key` and 422 land on the inputs (same names as the API fields).
        onError: (error) =>
          handleFormError(form, error, { fallback: t("toast.error"), fieldMap: { copy_from_role_id: "copy_from" } }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldPlusIcon className="size-5" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.name")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input autoComplete="off" disabled={mutation.isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role_key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.roleKey")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                      placeholder={t("fields.roleKeyPlaceholder")}
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="flex items-start gap-1">
                    <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {t("fields.roleKeyHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.description")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} disabled={mutation.isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="copy_from"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.copyFrom")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={mutation.isPending || roles.isLoading}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_COPY}>{t("fields.copyFromNone")}</SelectItem>
                      {(roles.data?.data ?? []).map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t("fields.copyFromHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sort_order"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.sortOrder")}</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" className="w-28" disabled={mutation.isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button disabled={mutation.isPending} type="button" variant="outline" className="w-full md:w-auto">
                  {t("buttons.cancel")}
                </Button>
              </DialogClose>
              <Button disabled={mutation.isPending} type="submit" className="w-full md:w-auto">
                {mutation.isPending ? <Spinner /> : null}
                {t("buttons.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
