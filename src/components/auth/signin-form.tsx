"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeClosed, LogIn } from "lucide-react";
import Cookies from "js-cookie";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { BorderBeam } from "@/components/ui/border-beam";
import { useMutationLogin } from "@/hooks/use-auth";
import { takeSignInNotice } from "@/lib/auth-session";
import AnimationContainer from "@/components/global/animation-container";
import { cn } from "@/lib/utils";

const REMEMBER_ME_COOKIE = "remembered_username";
const REMEMBER_ME_EXPIRY_DAYS = 30;

const createLoginSchema = (t: (key: string) => string) =>
  z.object({
    username: z
      .string()
      .min(1, { message: t("validation.usernameRequired") })
      .max(64, { message: t("validation.usernameTooLong") }),
    // The backend does not check the password policy at login (so it doesn't
    // leak it): only required + the 256-char cap.
    password: z
      .string()
      .min(1, { message: t("validation.passwordRequired") })
      .max(256, { message: t("validation.passwordTooLong") }),
    rememberMe: z.boolean(),
  });

type LoginFormValues = z.infer<ReturnType<typeof createLoginSchema>>;

export function SignInForm({ className, ...props }: React.ComponentProps<"div">) {
  const t = useTranslations("auth");
  const router = useRouter();
  const mutation = useMutationLogin();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(createLoginSchema(t)),
    defaultValues: { username: "", password: "", rememberMe: false },
  });

  // Load a remembered username from cookie on mount, same as the reference
  // project's SignInForm.
  useEffect(() => {
    const savedUsername = Cookies.get(REMEMBER_ME_COOKIE);
    if (savedUsername) {
      form.setValue("username", savedUsername);
      form.setValue("rememberMe", true);
    }
  }, [form]);

  // After a forced sign-out (session ended / revoked / refresh failed),
  // lib/axios.ts leaves a one-shot notice for this page.
  useEffect(() => {
    if (takeSignInNotice()) toast.info(t("notices.sessionEnded"), { id: "session-ended" });
  }, [t]);

  const onSubmit = (values: LoginFormValues) => {
    mutation.mutate(
      { username: values.username, password: values.password },
      {
        // Login's response is tokens only (no user/role, see
        // `types/user.d.ts`'s `LoginResponse`), so there's no permission
        // data to resolve a role-specific landing path from here. Land on
        // the neutral `/admin` dashboard — every authenticated user can
        // reach it — and let the next render's `RoutePermissionGuard` fetch
        // `/auth/me` (now that the access-token cookie is set) and handle
        // the real permission check/redirect itself.
        onSuccess: () => {
          toast.success(t("toast.success"));
          if (values.rememberMe) {
            Cookies.set(REMEMBER_ME_COOKIE, values.username, {
              expires: REMEMBER_ME_EXPIRY_DAYS,
            });
          } else {
            Cookies.remove(REMEMBER_ME_COOKIE);
          }
          router.replace("/admin");
        },
      }
    );
  };

  return (
    <div className={cn("flex w-full flex-col gap-6", className)} {...props}>
      <AnimationContainer delay={0.2} className="relative w-full rounded-2xl bg-transparent p-1.5">
        <BorderBeam size={250} duration={12} delay={9} />
        <Card>
        <CardHeader className="text-left">
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>
            <div className="text-left text-sm">{t("description")}</div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid gap-6">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem className="flex flex-col space-y-2">
                      <FormLabel>{t("usernameLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder={t("usernamePlaceholder")}
                          autoComplete="username"
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
                    <FormItem className="flex flex-col space-y-2">
                      <FormLabel>{t("passwordLabel")}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder={t("passwordPlaceholder")}
                            autoComplete="current-password"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                          >
                            {showPassword ? <Eye size={16} /> : <EyeClosed size={16} />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="rememberMe"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="cursor-pointer text-sm font-normal">
                        {t("rememberMe")}
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || mutation.isPending}>
                  {form.formState.isSubmitting || mutation.isPending ? (
                    <>
                      <Spinner />
                      {t("submittingButton")}
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      {t("submitButton")}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
        </Card>
      </AnimationContainer>
    </div>
  );
}
