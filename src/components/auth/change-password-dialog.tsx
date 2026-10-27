"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, LogOutIcon } from "lucide-react";
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
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLogout, useMutationChangePassword } from "@/hooks/use-auth";
import { API_ERROR_CODES, parseApiError } from "@/lib/api-error";

function createChangePasswordSchema(t: (key: string) => string) {
  return z
    .object({
      oldPassword: z.string().min(1, t("validation.oldPasswordRequired")),
      // Policy (doc/05 section 2.5): >= 12 characters; the server also checks
      // the rest (identity, common passwords) and answers field errors.
      password: z
        .string()
        .min(12, t("validation.passwordRequired"))
        .max(256, t("validation.passwordTooLong")),
      confirmPassword: z.string().min(1, t("validation.confirmPasswordRequired")),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("validation.passwordMismatch"),
      path: ["confirmPassword"],
    });
}

type ChangePasswordFormValues = z.infer<ReturnType<typeof createChangePasswordSchema>>;

// Maps API field names (JSON-Pointer first segment) to this form's names.
const FIELD_MAP = { old_password: "oldPassword", new_password: "password" } as const;

// Account change-password dialog (eye-toggle on all three fields).
// `forced` = the user must change the password before using the app
// (`must_change_password`): the dialog can't be dismissed (no Cancel, Esc or
// outside click), offers "Sign out" instead, and closes only once the parent
// stops rendering it after /auth/me reports the flag cleared.
export function ChangePasswordDialog({
  open,
  onOpenChange,
  forced = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forced?: boolean;
}) {
  const t = useTranslations("changePassword");
  const schema = createChangePasswordSchema(t);
  const mutation = useMutationChangePassword();
  const { translate, handleFormError } = useApiErrorHandler();
  const { logout, isPending: isLoggingOut } = useLogout();

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { oldPassword: "", password: "", confirmPassword: "" },
  });

  const handleClose = () => {
    if (forced) return;
    form.reset();
    onOpenChange(false);
  };

  const onSubmit = (values: ChangePasswordFormValues) => {
    mutation.mutate(
      { old_password: values.oldPassword, new_password: values.password },
      {
        onSuccess: () => {
          toast.success(t("toast.success"));
          form.reset();
          if (!forced) onOpenChange(false);
        },
        onError: (error) => {
          // 400 INVALID_OLD_PASSWORD -> error under the current-password field
          // (never 401: that would sign the user out).
          if (parseApiError(error).code === API_ERROR_CODES.INVALID_OLD_PASSWORD) {
            form.setError(
              "oldPassword",
              { type: "server", message: translate(error) },
              { shouldFocus: true }
            );
            return;
          }
          // 422 `errors[]` (`/new_password` password_policy.*) -> on the
          // matching field; otherwise a toast (429/5xx/403 are toasted globally).
          handleFormError(form, error, { fieldMap: FIELD_MAP, fallback: t("toast.error") });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-h-screen md:max-w-md [&>button]:hidden"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (forced || mutation.isPending) e.preventDefault();
          else handleClose();
        }}
        onInteractOutside={(e) => {
          if (forced || mutation.isPending) e.preventDefault();
          else handleClose();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{forced ? t("forced.description") : t("description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="oldPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.oldPassword")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={t("fields.oldPasswordPlaceholder")}
                      autoComplete="current-password"
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.newPassword")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={t("fields.newPasswordPlaceholder")}
                      autoComplete="new-password"
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
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("fields.confirmPassword")} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={t("fields.confirmPasswordPlaceholder")}
                      autoComplete="new-password"
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="flex justify-end gap-2">
              {forced ? (
                <Button
                  disabled={mutation.isPending || isLoggingOut}
                  type="button"
                  variant="outline"
                  className="w-full md:w-auto"
                  onClick={logout}
                >
                  <LogOutIcon />
                  {t("buttons.signOut")}
                </Button>
              ) : (
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
              )}
              <Button disabled={mutation.isPending} type="submit" className="w-full md:w-auto">
                {mutation.isPending ? <Spinner /> : null}
                {t("buttons.change")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
