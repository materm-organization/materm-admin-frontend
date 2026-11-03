"use client";

import { CircleAlertIcon, CircleCheckIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useWebhookText } from "@/components/protected/webhooks/webhook-text";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useMutationTestWebhook } from "@/hooks/use-webhooks";
import { classifyTestFailure, type TestFailure } from "@/lib/webhooks";
import type { Webhook, WebhookTestResult } from "@/types/webhooks";

// "Send a test": the signed `webhook.test` message goes to the address NOW, once, and the answer is shown here (doc/05 16.6). It works while
// the webhook is switched off, is not retried and does not count towards the 24-hour switch-off. Nothing is sent before the button is pressed.
// The receiver's answer is third-party text: it is shown inside <pre> as plain text only.
export function WebhookTestDialog({ webhook, onClose, onOpenDeliveries }: { webhook: Webhook; onClose: () => void; onOpenDeliveries?: () => void }) {
  const t = useTranslations("webhooks.test");
  const text = useWebhookText();
  const test = useMutationTestWebhook();
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const [failure, setFailure] = useState<TestFailure | null>(null);

  const run = async () => {
    setResult(null);
    setFailure(null);
    try {
      const res = await test.mutateAsync({ id: webhook.id });
      setResult(res.data);
    } catch (error) {
      setFailure(classifyTestFailure(error));
    }
  };

  const failureText = (f: TestFailure) =>
    f.kind === "not_configured"
      ? t("notConfigured")
      : f.kind === "rate_limited"
        ? f.retryAfter
          ? t("rateLimitedRetry", { seconds: f.retryAfter })
          : t("rateLimited")
        : f.kind === "unavailable"
          ? t("unavailable")
          : t("failed");

  return (
    <Dialog open onOpenChange={(open) => !open && !test.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="webhook-test-dialog">
        <DialogHeader>
          <DialogTitle className="leading-snug">{t("title", { name: webhook.name })}</DialogTitle>
          <DialogDescription className="leading-snug">{t("description")}</DialogDescription>
        </DialogHeader>

        <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs" data-testid="webhook-test-url">{webhook.url}</p>
        {!webhook.is_active ? <p className="text-xs leading-snug text-muted-foreground">{t("inactiveNote")}</p> : null}

        {failure ? (
          <Alert variant="destructive" data-testid="webhook-test-failure" data-kind={failure.kind}>
            <CircleAlertIcon />
            <AlertDescription className="leading-snug">{failureText(failure)}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <div className="space-y-3" data-testid="webhook-test-result" data-ok={String(result.ok)}>
            <Alert variant={result.ok ? "default" : "destructive"}>
              {result.ok ? <CircleCheckIcon /> : <CircleAlertIcon />}
              <AlertTitle className="leading-snug">{result.ok ? t("okTitle") : t("notOkTitle")}</AlertTitle>
              <AlertDescription className="leading-snug">
                {result.ok ? t("okText") : result.error_class ? text.errorClass(result.error_class) : t("notOkText")}
              </AlertDescription>
            </Alert>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("statusCode")}</dt>
              <dd data-testid="webhook-test-status-code">{result.status_code ?? "-"}</dd>
              <dt className="text-muted-foreground">{t("latency")}</dt>
              <dd data-testid="webhook-test-latency">{result.latency_ms === null ? "-" : t("ms", { value: result.latency_ms })}</dd>
              {result.error_class ? (
                <>
                  <dt className="text-muted-foreground">{t("reason")}</dt>
                  <dd>{text.errorClass(result.error_class)}</dd>
                </>
              ) : null}
            </dl>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-snug">{t("response")}</p>
              {result.response_snippet ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 font-mono text-xs" data-testid="webhook-test-snippet">
                  {result.response_snippet}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noResponse")}</p>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          {onOpenDeliveries && result ? (
            <Button type="button" variant="outline" onClick={onOpenDeliveries}>
              {t("seeDeliveries")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose} disabled={test.isPending}>
            {t("close")}
          </Button>
          <Button type="button" onClick={() => void run()} disabled={test.isPending}>
            {test.isPending ? <Spinner /> : <SendIcon />} {result || failure ? t("again") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
