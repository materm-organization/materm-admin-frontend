"use client";

import { AlertTriangleIcon, FileJsonIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationBundleSync } from "@/hooks/use-ui-strings";
import { parseApiError } from "@/lib/api-error";
import type { ApiFieldError } from "@/types/api";
import type { BundleSyncResult, UiStringsBundleManifest } from "@/types/ui-strings";

const MAX_BYTES = 1_000_000;

// "Sync from the website bundle" (doc/05 section 11.4, doc/08 section 8.9): choose the `ui-strings.json` the portal's
// export script writes, see a dry-run report (nothing is written), then apply. Needs `cms.ui_strings:import`.
export function BundleSyncDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <Content onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

// The body of POST /ui-strings/bundle-sync is STRICT (an unknown field is a 422 `unknown_field`, found by the real-backend run), while
// the file `cms:export --stamp` writes also carries `schema_version`, `expected_count` and `pending`. Send only what the contract names.
export function toManifest(parsed: UiStringsBundleManifest): UiStringsBundleManifest {
  return {
    generated_at: parsed.generated_at,
    source_commit: parsed.source_commit,
    keys: parsed.keys.map((k) => ({ key: k.key, namespace: k.namespace, values: k.values })),
  };
}

function Content({ onClose }: { onClose: () => void }) {
  const t = useTranslations("uiStrings.sync");
  const { toastError } = useApiErrorHandler();
  const sync = useMutationBundleSync();
  const inputId = useId();
  const [manifest, setManifest] = useState<UiStringsBundleManifest | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [report, setReport] = useState<BundleSyncResult | null>(null);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);

  const onFile = async (file: File | undefined) => {
    setReport(null);
    setServerErrors([]);
    setManifest(null);
    setFileError(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) return setFileError(t("tooLarge"));
    try {
      const parsed = JSON.parse(await file.text()) as UiStringsBundleManifest;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keys) || typeof parsed.source_commit !== "string") {
        return setFileError(t("badShape"));
      }
      const clean = toManifest(parsed);
      setManifest(clean);
      // The first thing a chosen file does is a dry run: nothing is written.
      void run(clean, true);
    } catch {
      setFileError(t("notJson"));
    }
  };

  const run = async (m: UiStringsBundleManifest, dryRun: boolean) => {
    setServerErrors([]);
    try {
      const result = await sync.mutateAsync({ manifest: m, dryRun });
      setReport(result.data);
      if (!dryRun) {
        toast.success(t("applied"));
        onClose();
      }
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.fieldErrors.length) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
      setReport(null);
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{t("file")}</Label>
          <Input id={inputId} type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
          {fileName && !fileError ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><FileJsonIcon className="size-3.5" aria-hidden /> {fileName}</p> : null}
          {fileError ? <p role="alert" className="text-sm text-destructive">{fileError}</p> : null}
        </div>

        {sync.isPending ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> {t("checking")}</p> : null}

        {serverErrors.length ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("rejected")}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {serverErrors.slice(0, 8).map((e, i) => (
                  <li key={i}><span className="font-mono text-xs">{e.path}</span> {e.code}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {report ? (
          <section aria-label={t("report")} className="space-y-3 text-sm" data-testid="sync-report">
            <p className="font-medium">{report.dry_run ? t("dryRun") : t("done")}</p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(["keys", "inserted", "source_updated", "kept_override", "unchanged"] as const).map((k) => (
                <div key={k} className="rounded-md border p-2">
                  <dt className="text-xs text-muted-foreground">{t(`counts.${k}`)}</dt>
                  <dd className="text-lg font-semibold" data-testid={`count-${k}`}>{report.counts[k]}</dd>
                </div>
              ))}
            </dl>
            {report.manifest.unchanged ? <p className="text-muted-foreground">{t("manifestUnchanged")}</p> : null}
            {report.new_keys.length ? (
              <div>
                <p className="font-medium">{t("newKeys", { count: report.new_keys.length })}</p>
                <p className="font-mono text-xs break-all text-muted-foreground">{report.new_keys.join(", ")}</p>
              </div>
            ) : null}
            {report.placeholder_conflicts.length ? (
              <Alert role="status">
                <AlertTriangleIcon />
                <AlertTitle>{t("conflicts", { count: report.placeholder_conflicts.length })}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {report.placeholder_conflicts.map((c) => (
                      <li key={`${c.key}-${c.locale}`} className="font-mono text-xs">{c.key} ({c.locale}): {`{${c.expected.join("}, {")}}`} vs {`{${c.actual.join("}, {")}}`}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {report.orphan_count ? (
              <div>
                <p className="font-medium">{t("orphans", { count: report.orphan_count })}</p>
                <p className="font-mono text-xs break-all text-muted-foreground">{report.orphans.join(", ")}{report.truncated ? " …" : ""}</p>
                <p className="text-xs text-muted-foreground">{t("orphansNote")}</p>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={sync.isPending}>{t("cancel")}</Button>
        <Button type="button" disabled={!manifest || !report?.dry_run || sync.isPending} onClick={() => manifest && void run(manifest, false)}>
          {sync.isPending && !report?.dry_run ? <Spinner /> : null} {t("apply")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
