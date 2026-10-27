"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { InvalidLinkCard } from "@/components/auth/invalid-link-card";
import { PasswordPolicyChecklist } from "@/components/auth/password-policy-checklist";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationResetPassword } from "@/hooks/use-auth";
import { useFragmentToken } from "@/hooks/use-fragment-token";
import { API_ERROR_CODES, parseApiError } from "@/lib/api-error";
import { FORGOT_PASSWORD_PATH, SIGN_IN_NOTICE, SIGN_IN_PATH, setSignInNotice } from "@/lib/auth-session";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, codePointLength } from "@/lib/password-policy";

function createSchema(t: (key: string) => string) {
  return z
    .object({
      password: z
        .string()
        .refine((v) => codePointLength(v) >= PASSWORD_MIN_LENGTH, t("validation.passwordTooShort"))
        .refine((v) => codePointLength(v) <= PASSWORD_MAX_LENGTH, t("validation.passwordTooLong")),
      confirmPassword: z.string().min(1, t("validation.confirmRequired")),
    })
    .refine((v) => v.password === v.confirmPassword, {
      message: t("validation.mismatch"),
      path: ["confirmPassword"],
    });
}
type Values = z.infer<ReturnType<typeof createSchema>>;

// SCR-03. The one-time token is read from the URL fragment (`#token=…`) and removed from the address bar at once
// (useFragmentToken); it lives only in this component's state and is sent only in the POST body. Success -> sign-in
// with a notice (no tokens come back; the reset ended every session). 400 INVALID_TOKEN, or no token at all, ->
// the "link invalid or expired" state with a way to ask for a new one. 422 `password_policy.*` (incl. `reused`)
// lands on the password field and turns the matching checklist row red; the token is NOT consumed by a 422, so
// the user just tries another password.
export function ResetPasswordForm() {
  const t = useTranslations("auth.reset");
  const router = useRouter();
  const fragment = useFragmentToken();
  const mutation = useMutationResetPassword();
  const { handleFormError } = useApiErrorHandler();
  const [tokenRejected, setTokenRejected] = useState(false);
  const [serverCodes, setServerCodes] = useState<string[]>([]);

  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const password = useWatch({ control: form.control, name: "password" });

  if (fragment.status === "pending") {
    return (
      <div className="flex min-h-40 items-center justify-center" role="status" aria-label={t("loading")}>
        <Spinner className="size-6" />
      </div>
    );
  }

  if (fragment.status === "missing" || tokenRejected) {
    return (
      <InvalidLinkCard
        title={t("invalid.title")}
        description={t("invalid.description")}
        actionHref={FORGOT_PASSWORD_PATH}
        actionLabel={t("invalid.requestNew")}
        secondary={
          <Button asChild variant="ghost" className="w-full">
            <Link href={SIGN_IN_PATH}>{t("backToSignIn")}</Link>
          </Button>
        }
      />
    );
  }

  const token = fragment.token;
  const onSubmit = (values: Values) => {
    setServerCodes([]);
    mutation.mutate(
      { token, new_password: values.password },
      {
        onSuccess: () => {
          setSignInNotice(SIGN_IN_NOTICE.PASSWORD_RESET);
          router.replace(SIGN_IN_PATH);
        },
        onError: (error) => {
          const parsed = parseApiError(error);
          if (parsed.code === API_ERROR_CODES.INVALID_TOKEN) {
            setTokenRejected(true);
            return;
          }
          setServerCodes(parsed.fieldErrors.filter((f) => f.path === "/new_password").map((f) => f.code));
          handleFormError(form, error, { fieldMap: { new_password: "password" }, fallback: t("error") });
        },
      }
    );
  };

  const busy = mutation.isPending;
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("passwordLabel")}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      autoFocus
                      disabled={busy}
                      showPasswordLabel={t("showPassword")}
                      hidePasswordLabel={t("hidePassword")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <PasswordPolicyChecklist password={password} serverCodes={serverCodes} showReused />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("confirmLabel")}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" disabled={busy} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : <KeyRoundIcon />}
              {busy ? t("submitting") : t("submit")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
