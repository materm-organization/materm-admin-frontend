import type { SlugStatus } from "@/components/protected/posts/slug-field";
import type { PostDraft, PostEditMode } from "@/components/protected/posts/post-draft";
import type { Locale } from "@/types/locales";
import type { PostDetail } from "@/types/posts";

// What every tab of the post editor gets: the shared draft (the editor owns it), the server's version it is compared with,
// the messages of the problems by field key, and what the signed-in user may write.
export type PostFormProps = {
  post: PostDetail;
  draft: PostDraft;
  baseline: PostDraft;
  onChange: (next: PostDraft) => void;
  // Field key (`title.la`, `tag_ids` ...) -> the text to show under the field.
  problems: Record<string, string>;
  // Active languages and the default one.
  locales: Locale[];
  defaultLocale: string;
  mode: PostEditMode;
  onSlugStatus?: (locale: string, status: SlugStatus) => void;
};

// May the user write the TEXTS of `locale` (05 13.3.3): everything for `full`, only the languages that are not the default
// one for `translate`.
export const textsEditable = (mode: PostEditMode, locale: string, defaultLocale: string) =>
  mode === "full" || (mode === "translate" && locale !== defaultLocale);

export const shortLabel = (locales: Locale[], code: string) => locales.find((l) => l.code === code)?.short_label || code.toUpperCase();
