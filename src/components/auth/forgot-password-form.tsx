"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, MailCheckIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationForgotPassword } from "@/hooks/use-auth";
import { API_ERROR_CODES, parseApiError } from "@/lib/api-error";
import { SIGN_IN_PATH } from "@/lib/auth-session";

// SCR-02. Username or e-mail, 3-254 characters (counted in code points). The server answers 200 whether or not
// the account exists, so the page ALWAYS shows its own neutral text on a 200 (never the server's `message`, never
// anything that tells the two cases apart). A 429 (10 requests / hour / IP) disables the button for `Retry-After`
// seconds.
function createSchema(t: (key: string) => string) {
  return z.object({
    identifier: z
      .string()
      .trim()
      .refine((v) => [...v].length >= 3, t("validation.identifierTooShort"))
      .refine((v) => [...v].length <= 254, t("validation.identifierTooLong")),
  });
}
type Values = z.infer<ReturnType<typeof createSchema>>;

export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgot");
  const mutation = useMutationForgotPassword();
  const { handleFormError } = useApiErrorHandler();
  const [sent, setSent] = useState(false);
  // Seconds left of a `Retry-After` cool-down (0 = none).
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)),
    defaultValues: { identifier: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const onSubmit = (values: Values) => {
    mutation.mutate(
      { identifier: values.identifier },
      {
        onSuccess: () => setSent(true),
        onError: (error) => {
          const parsed = parseApiError(error);
          // 429 is also toasted once by the global handler; the inline note + disabled button stay.
          if (parsed.status === 429 || parsed.code === API_ERROR_CODES.RATE_LIMITED) {
            setCooldown(parsed.retryAfter ?? 60);
            return;
          }
          handleFormError(form, error, { fallback: t("error") });
        },
      }
    );
  };

  if (sent) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheckIcon className="size-5" aria-hidden />
            {t("sent.title")}
          </CardTitle>
          <CardDescription role="status">{t("sent.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href={SIGN_IN_PATH}>
              <ArrowLeftIcon />
              {t("backToSignIn")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

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
              name="identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("identifierLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="username"
                      autoFocus
                      placeholder={t("identifierPlaceholder")}
                      disabled={busy}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {cooldown > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                {cooldown > 90
                  ? t("throttledMinutes", { minutes: Math.ceil(cooldown / 60) })
                  : t("throttled", { seconds: cooldown })}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || cooldown > 0}>
              {busy ? <Spinner /> : <SendIcon />}
              {busy ? t("submitting") : t("submit")}
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href={SIGN_IN_PATH}>
                <ArrowLeftIcon />
                {t("backToSignIn")}
              </Link>
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
