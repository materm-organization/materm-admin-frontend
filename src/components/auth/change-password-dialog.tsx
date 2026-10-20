"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon } from "lucide-react";
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
import { useMutationChangePassword } from "@/hooks/use-auth";

function createChangePasswordSchema(t: (key: string) => string) {
  return z
    .object({
      oldPassword: z.string().min(1, t("validation.oldPasswordRequired")),
      password: z.string().min(6, t("validation.passwordRequired")),
      confirmPassword: z.string().min(6, t("validation.confirmPasswordRequired")),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("validation.passwordMismatch"),
      path: ["confirmPassword"],
    });
}

type ChangePasswordFormValues = z.infer<ReturnType<typeof createChangePasswordSchema>>;

// Account self-service change-password dialog (eye-toggle on all three
// fields).
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("changePassword");
  const schema = createChangePasswordSchema(t);
  const mutation = useMutationChangePassword();

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { oldPassword: "", password: "", confirmPassword: "" },
  });

  const handleClose = () => {
    form.reset();
    onOpenChange(false);
  };

  const onSubmit = (values: ChangePasswordFormValues) => {
    const loadingId = toast.loading(t("toast.loading"));
    mutation.mutate(
      { old_password: values.oldPassword, new_password: values.password },
      {
        onSuccess: () => {
          toast.success(t("toast.success"), { id: loadingId });
          handleClose();
        },
        onError: () => {
          toast.dismiss(loadingId);
          toast.error(t("toast.error"));
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-h-screen md:max-w-md [&>button]:hidden"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => {
          if (!mutation.isPending) handleClose();
        }}
        onInteractOutside={(e) => {
          if (!mutation.isPending) {
            handleClose();
          } else {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
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
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                {t("buttons.change")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
