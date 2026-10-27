"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlusIcon } from "lucide-react";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useMutationCreateUser, useRoles } from "@/hooks/use-users";

const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{3,64}$/;

function createUserSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().trim().min(1, t("validation.nameRequired")).max(120, t("validation.nameTooLong")),
    username: z.string().trim().regex(USERNAME_PATTERN, t("validation.usernameInvalid")),
    // Optional; "" = not provided.
    email: z.union([
      z.literal(""),
      z.string().trim().email(t("validation.emailInvalid")).max(254, t("validation.emailTooLong")),
    ]),
    role_id: z.string().min(1, t("validation.roleRequired")),
  });
}

type CreateUserFormValues = z.infer<ReturnType<typeof createUserSchema>>;

// Creates a user with `delivery: "temporary_password"` (the only mode in P0).
// On success hands the one-time password to `onCreated`; the form field names
// equal the API field names, so server `errors[]` land on the right input.
export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { username: string; temporaryPassword: string | null }) => void;
}) {
  const t = useTranslations("users.create");
  const mutation = useMutationCreateUser();
  const roles = useRoles(open);
  const { handleFormError } = useApiErrorHandler();
  // One key per open of the dialog: a double click / retry after a lost response replays the same request.
  const idempotencyKey = useIdempotencyKey(open);

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema(t)),
    defaultValues: { name: "", username: "", email: "", role_id: "" },
  });

  const handleOpenChange = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) form.reset();
    onOpenChange(next);
  };

  const onSubmit = (values: CreateUserFormValues) => {
    mutation.mutate(
      {
        payload: {
          name: values.name,
          username: values.username,
          role_id: Number(values.role_id),
          delivery: "temporary_password",
          ...(values.email ? { email: values.email } : {}),
        },
        idempotencyKey,
      },
      {
        onSuccess: (res) => {
          const result = {
            username: res.data.user.username,
            temporaryPassword: res.data.temporary_password,
          };
          // Drop the response (it holds the password) from the mutation state.
          mutation.reset();
          form.reset();
          onOpenChange(false);
          toast.success(t("toast.success"));
          onCreated(result);
        },
        // 422/409 `errors[]` -> on the matching input; 403 SUPER_ADMIN_PROTECTED,
        // 429, 5xx -> global toast.
        onError: (error) => handleFormError(form, error, { fallback: t("toast.error") }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlusIcon className="size-5" />
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
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.username")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder={t("fields.usernamePlaceholder")}
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.email")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.role")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={mutation.isPending || roles.isLoading}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("fields.rolePlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(roles.data?.data ?? []).map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-xs text-muted-foreground">{t("passwordNote")}</p>
            <DialogFooter className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button
                  disabled={mutation.isPending}
                  type="button"
                  variant="outline"
                  className="w-full md:w-auto"
                >
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
