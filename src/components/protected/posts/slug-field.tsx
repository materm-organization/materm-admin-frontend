"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { PostField } from "@/components/protected/posts/post-field";
import { useDebouncedValue } from "@/components/schema-form/widgets/use-debounced";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { MAX_SLUG, slugProblem } from "@/lib/posts";
import { PostsAPI } from "@/services/posts.api";
import type { PostSlugCheck } from "@/types/posts";

// How long the person stops typing before the check goes out (doc/07 section 3.15).
const DEBOUNCE_MS = 500;

export type SlugStatus = "idle" | "checking" | "ok" | "taken" | "invalid";

// The slug of one language (doc/05 13.3.4, doc/07 SCR-25): the input, and below it the answer of `GET /posts/slug-check`
// 500 ms after the last keystroke - available, taken (by which post, with the suggestion in one click) or not valid. The check
// only sees the real rows of other posts; the same slug in a pending draft of another post is caught when it is published.
// An unchanged slug is not checked. `onStatus` tells the editor whether the slug is taken so it can hold the save back.
export function SlugField({
  id,
  postId,
  locale,
  value,
  stored,
  onChange,
  onStatus,
  disabled,
  error,
  label,
  badge,
  wasPublished,
}: {
  id: string;
  // Absent while the post does not exist yet (the create dialog).
  postId?: number;
  locale: string;
  value: string;
  // The slug the server has for this language ("" = no row yet).
  stored: string;
  onChange: (slug: string) => void;
  onStatus?: (locale: string, status: SlugStatus) => void;
  disabled: boolean;
  error?: string;
  label: string;
  badge?: React.ReactNode;
  // The post has been published: changing the slug leaves the old link without a page.
  wasPublished?: boolean;
}) {
  const t = useTranslations("posts.slug");
  const typed = value.trim().toLowerCase();
  const debounced = useDebouncedValue(typed, DEBOUNCE_MS);
  const clientProblem = typed ? slugProblem(typed) : null;
  const unchanged = typed === stored;
  const wantsCheck = typed !== "" && !unchanged && clientProblem === null;
  const settled = debounced === typed;

  const check = useQuery<PostSlugCheck>({
    queryKey: [API_ENDPOINTS.POSTS.SLUG_CHECK, postId ?? null, locale, debounced],
    queryFn: () => PostsAPI.SlugCheck({ locale, slug: debounced, ...(postId !== undefined ? { post_id: postId } : {}) }),
    enabled: wantsCheck && settled,
    staleTime: 15_000,
    retry: false,
  });

  const status: SlugStatus = !wantsCheck
    ? clientProblem ? "invalid" : "idle"
    : !settled || check.isFetching
      ? "checking"
      : check.data
        ? !check.data.valid ? "invalid" : check.data.available ? "ok" : "taken"
        : "idle";
  const taken = status === "taken" && check.data?.conflict ? check.data : null;

  useEffect(() => {
    onStatus?.(locale, status);
  }, [locale, status, onStatus]);

  const statusNode = (
    <span id={`${id}-status`} className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-live="polite" data-testid={`${id}-status`} data-status={status}>
      {status === "idle" ? t("hint") : null}
      {status === "checking" ? (
        <span className="inline-flex items-center gap-1">
          <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
          {t("checking")}
        </span>
      ) : null}
      {status === "ok" ? (
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
          <CheckIcon className="size-3.5" aria-hidden />
          {t("available")}
        </span>
      ) : null}
      {status === "invalid" ? (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XIcon className="size-3.5" aria-hidden />
          {clientProblem === "too_long" || check.data?.reason === "too_long" ? t("tooLong", { max: MAX_SLUG }) : t("format")}
        </span>
      ) : null}
      {taken ? (
        <>
          <span className="inline-flex items-center gap-1 text-destructive">
            <XIcon className="size-3.5" aria-hidden />
            {taken.conflict?.title ? t("takenBy", { title: taken.conflict.title }) : t("taken")}
          </span>
          {taken.suggestion ? (
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={disabled} onClick={() => onChange(taken.suggestion!)}>
              {t("use", { slug: taken.suggestion })}
            </Button>
          ) : null}
        </>
      ) : null}
    </span>
  );

  return (
    <PostField id={id} label={label} badge={badge} counter={{ length: value.length, max: MAX_SLUG }} error={error} hint={statusNode}>
      <Input
        id={id}
        className="font-mono"
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error || status === "taken" || status === "invalid" ? true : undefined}
        aria-describedby={`${id}-status`}
        onChange={(e) => onChange(e.target.value)}
      />
      {wasPublished && stored !== "" && typed !== stored ? (
        <Alert data-testid="slug-changed-warning">
          <AlertDescription>{t("changedPublished", { slug: stored })}</AlertDescription>
        </Alert>
      ) : null}
    </PostField>
  );
}
