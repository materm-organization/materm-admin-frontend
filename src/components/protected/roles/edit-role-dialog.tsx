"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConflictDialog } from "@/components/global/conflict-dialog";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationUpdateRole } from "@/hooks/use-roles";
import type { RoleDetail } from "@/types/iam";

function editRoleSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().trim().min(1, t("validation.nameRequired")).max(80, t("validation.nameTooLong")),
    description: z.string().trim().max(500, t("validation.descriptionTooLong")),
    sort_order: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, t("validation.sortOrderInvalid"))
      .refine((v) => Number(v) >= 0 && Number(v) <= 1000, t("validation.sortOrderInvalid")),
  });
}
type EditRoleValues = z.infer<ReturnType<typeof editRoleSchema>>;

// PATCH /roles/{id} (name, description, sort order; the key is immutable). `If-Match` is mandatory: a 409/412
// opens the ConflictDialog, whose "load the latest version" refetches the role (new ETag) and closes this one.
// Mount it only while open, keyed by the ETag, so the form starts from the current values.
export function EditRoleDialog({
  role,
  etag,
  onClose,
  onReload,
}: {
  role: RoleDetail;
  etag: string | undefined;
  onClose: () => void;
  onReload: () => Promise<unknown>;
}) {
  const t = useTranslations("roles.edit");
  const tv = useTranslations("roles.create");
  const mutation = useMutationUpdateRole(role.id);
  const { handleFormError } = useApiErrorHandler();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const form = useForm<EditRoleValues>({
    resolver: zodResolver(editRoleSchema(tv)),
    defaultValues: { name: role.name, description: role.description, sort_order: String(role.sort_order) },
  });

  const onSubmit = (values: EditRoleValues) => {
    const payload = {
      ...(values.name !== role.name ? { name: values.name } : {}),
      ...(values.description !== role.description ? { description: values.description } : {}),
      ...(Number(values.sort_order) !== role.sort_order ? { sort_order: Number(values.sort_order) } : {}),
    };
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    mutation.mutate(
      { payload, etag },
      {
        onSuccess: () => {
          toast.success(t("toast.success"));
          onClose();
        },
        onError: (error) =>
          handleFormError(form, error, { fallback: t("toast.error"), onConflict: () => setConflictOpen(true) }),
      }
    );
  };

  const reload = async () => {
    setIsReloading(true);
    try {
      await onReload();
    } finally {
      setIsReloading(false);
    }
    onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => (!open && !mutation.isPending ? onClose() : undefined)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilIcon className="size-5" aria-hidden />
              {t("title")}
            </DialogTitle>
            <DialogDescription>{t("description", { roleKey: role.role_key })}</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tv("fields.name")} <span className="text-destructive">*</span>
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tv("fields.description")}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} disabled={mutation.isPending} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sort_order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tv("fields.sortOrder")}</FormLabel>
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
                  {t("buttons.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        onReload={reload}
        isReloading={isReloading}
        myChanges={[
          { label: tv("fields.name"), value: form.getValues("name") },
          { label: tv("fields.description"), value: form.getValues("description") || "—" },
          { label: tv("fields.sortOrder"), value: form.getValues("sort_order") },
        ]}
      />
    </>
  );
}
