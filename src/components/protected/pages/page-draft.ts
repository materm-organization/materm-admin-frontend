// Client-side rules for a new page (doc/07 section 3.11, doc/05 12.3.2). The server decides for real (BR-03); these
// only save a round trip and say what is wrong at the field.
import type { CreatePagePayload, PageTemplate } from "@/types/pages";

export const MAX_TITLE = 120;
export const MAX_PATH = 200;

const PATH_FORMAT = /^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/;
const RESERVED = /^\/(api|_next|admin|preview)(\/|$)/;

export type PathProblem = "required" | "root" | "format" | "reserved" | "blog_child" | "too_long";

// `Summer trek!` -> `summer-trek`; text with no ASCII letters (Lao, Thai) gives "" and the author types the address.
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const pathFromTitle = (title: string): string => {
  const slug = slugify(title).slice(0, MAX_PATH - 1);
  return slug ? `/${slug}` : "";
};

export function pathProblem(path: string): PathProblem | null {
  if (path === "") return "required";
  if (path === "/") return "root"; // `/` belongs to the home page only
  if ([...path].length > MAX_PATH) return "too_long";
  // The reserved prefixes first: `/_next` is not even a valid address, but "reserved" is the better thing to say.
  if (RESERVED.test(path)) return "reserved";
  if (!PATH_FORMAT.test(path)) return "format";
  if (path.startsWith("/blog/")) return "blog_child";
  return null;
}

export type CreateDraft = { template: string; title: string; path: string; pathEdited: boolean };

export function emptyCreateDraft(templates: PageTemplate[]): CreateDraft {
  return { template: templates.find((t) => t.is_default)?.key ?? templates[0]?.key ?? "", title: "", path: "", pathEdited: false };
}

export type CreateProblems = { template?: "required"; title?: "required" | "too_long"; path?: PathProblem };

export function validateCreate(draft: CreateDraft): CreateProblems {
  const problems: CreateProblems = {};
  if (!draft.template) problems.template = "required";
  const title = draft.title.trim();
  if (!title) problems.title = "required";
  else if ([...title].length > MAX_TITLE) problems.title = "too_long";
  const path = pathProblem(draft.path.trim());
  if (path) problems.path = path;
  return problems;
}

export function buildCreatePayload(draft: CreateDraft, defaultLocale: string): CreatePagePayload {
  return { template: draft.template, path: draft.path.trim(), translations: { [defaultLocale]: { title: draft.title.trim() } } };
}
