"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";

import { DateTimeField } from "@/components/global/date-time-field";
import { PostField } from "@/components/protected/posts/post-field";
import { shortLabel, type PostFormProps } from "@/components/protected/posts/post-form-props";
import { PostTagsField } from "@/components/protected/posts/post-tags-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCategories } from "@/hooks/use-taxonomy";

const NONE = "__none__";

// The Details tab of SCR-25 (doc/07 section 3.15): the category, the tags, the author (the person who created the post: there
// is no author record in P1, so it is shown, not chosen), the display date, the "featured" flag and which languages are on.
export type PostDateControl = {
  value: string | null;
  dirty: boolean;
  saving: boolean;
  // The text under the field when the date is not acceptable.
  problem?: string;
  onChange: (value: string | null) => void;
  onSave: () => void;
};

export function PostDetailsTab({ post, draft, onChange, problems, locales, defaultLocale, mode, date }: PostFormProps & { date: PostDateControl }) {
  const t = useTranslations("posts.details");
  const format = useFormatter();
  const ui = useLocale();
  const categories = useCategories({ limit: 100 });
  const full = mode === "full";
  const rows = (categories.data?.data ?? []).filter((c) => !c.deleted_at);
  const name = (c: (typeof rows)[number]) => c.translations[ui]?.name ?? c.translations[defaultLocale]?.name ?? c.key;
  // The category the post has, also when it is not in the list (inactive / not loaded yet).
  const currentRef = post.category && draft.category_id === post.category.id ? post.category : null;
  const problem = (key: string) => problems[key];
  const set = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch });
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "-");

  return (
    <div className="space-y-8" data-testid="post-details">
      <section className="space-y-4" aria-labelledby="post-taxonomy">
        <h2 id="post-taxonomy" className="text-sm font-semibold">
          {t("taxonomy")}
        </h2>
        <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
          <PostField id="post-field-category_id" label={t("category")} required hint={t("categoryHint")}>
            <Select value={draft.category_id === null ? NONE : String(draft.category_id)} disabled={!full} onValueChange={(v) => set({ category_id: v === NONE ? null : Number(v) })}>
              <SelectTrigger id="post-field-category_id" className="w-full">
                <SelectValue placeholder={t("categoryNone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("categoryNone")}</SelectItem>
                {currentRef && !rows.some((c) => c.id === currentRef.id) ? <SelectItem value={String(currentRef.id)}>{currentRef.name ?? currentRef.key}</SelectItem> : null}
                {rows.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} disabled={!c.is_active && c.id !== draft.category_id}>
                    {name(c)}
                    {c.is_active ? "" : ` (${t("categoryInactive")})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PostField>

          <PostField id="post-field-tag_ids" label={t("tags")} hint={t("tagsHint")} error={problem("tag_ids")}>
            <PostTagsField id="post-field-tag_ids" value={draft.tag_ids} disabled={!full} defaultLocale={defaultLocale} tagRefs={post.tags} onChange={(tag_ids) => set({ tag_ids })} />
          </PostField>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="post-publishing">
        <h2 id="post-publishing" className="text-sm font-semibold">
          {t("publishing")}
        </h2>
        <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
          <PostField id="post-field-author" label={t("author")} hint={t("authorHint")}>
            <p id="post-field-author" className="flex h-9 items-center text-sm" data-testid="post-author">
              {post.created_by?.name ?? t("authorNone")}
            </p>
          </PostField>

          {/* The display date is NOT part of the draft: it has its own save (a PATCH that carries nothing else), and on a published
              post it goes live at once. */}
          <PostField
            id="post-field-published_at"
            label={t("publishedAt")}
            hint={post.status === "published" ? t("publishedAtHintLive") : t("publishedAtHint")}
            error={date.problem}
          >
            <div className="flex flex-wrap items-center gap-2" data-testid="post-date-control">
              <DateTimeField id="post-field-published_at" value={date.value} disabled={!full || date.saving} onChange={date.onChange} aria-label={t("publishedAt")} />
              <Button type="button" size="sm" variant="outline" disabled={!full || !date.dirty || Boolean(date.problem) || date.saving} onClick={date.onSave}>
                {date.saving ? <Spinner /> : null}
                {t("saveDate")}
              </Button>
            </div>
          </PostField>

          <div className="space-y-1.5" data-field="post-field-is_featured">
            <div className="flex min-h-6 items-center">
              <Label htmlFor="post-field-is_featured">{t("featured")}</Label>
            </div>
            <div className="flex h-9 items-center gap-2">
              <Switch id="post-field-is_featured" checked={draft.is_featured} disabled={!full} onCheckedChange={(is_featured) => set({ is_featured })} />
              <span className="text-sm text-muted-foreground">{t("featuredHint")}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="post-languages">
        <h2 id="post-languages" className="text-sm font-semibold">
          {t("languages")}
        </h2>
        <ul className="space-y-2">
          {locales.map((l) => {
            const d = draft.translations[l.code];
            if (!d) return null;
            const isDefault = l.code === defaultLocale;
            return (
              <li key={l.code} className="flex items-center gap-3">
                <Switch
                  id={`post-field-is_enabled-${l.code}`}
                  checked={d.is_enabled}
                  disabled={!full || isDefault || !d.exists}
                  onCheckedChange={(on) => onChange({ ...draft, translations: { ...draft.translations, [l.code]: { ...d, is_enabled: on } } })}
                />
                <Label htmlFor={`post-field-is_enabled-${l.code}`} className="font-normal">
                  {t("languageOn", { locale: shortLabel(locales, l.code) })}
                </Label>
                {isDefault ? <Badge variant="secondary">{t("languageDefault")}</Badge> : null}
                {!d.exists ? <span className="text-xs text-muted-foreground">{t("languageNoText")}</span> : null}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{t("languagesHint")}</p>
      </section>

      <section className="space-y-2" aria-labelledby="post-facts">
        <h2 id="post-facts" className="text-sm font-semibold">
          {t("facts")}
        </h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t("createdAt")}</dt>
            <dd>{when(post.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("updatedAt")}</dt>
            <dd>
              {when(post.updated_at)}
              {post.updated_by?.name ? <span className="block text-xs text-muted-foreground">{post.updated_by.name}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("firstPublished")}</dt>
            <dd>{when(post.first_published_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("lastPublished")}</dt>
            <dd>{when(post.status === "published" ? post.published_at : null)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
