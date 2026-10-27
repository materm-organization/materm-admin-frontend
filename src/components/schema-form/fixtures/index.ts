// The 12 section types (copies of doc/content-schemas/*.json, the shape of `GET /section-types/{key}`) and the
// 17 example sections of doc/content-schemas/examples/page.*.json. Used by tests, the MSW handlers and the dev
// playground. `fixtures.drift.test.ts` compares them with ../doc when that folder exists.
import type { SectionType } from "@/types/cms";

import aboutBlocks from "./section-types/about_blocks.json";
import blogStrip from "./section-types/blog_strip.json";
import contactSection from "./section-types/contact_section.json";
import faq from "./section-types/faq.json";
import galleryCards from "./section-types/gallery_cards.json";
import heroArticle from "./section-types/hero_article.json";
import heroBrand from "./section-types/hero_brand.json";
import introHeading from "./section-types/intro_heading.json";
import introText from "./section-types/intro_text.json";
import photoStory from "./section-types/photo_story.json";
import postList from "./section-types/post_list.json";
import teaserCollage from "./section-types/teaser_collage.json";

import pageBlog from "./examples/page.blog.json";
import pageContact from "./examples/page.contact.json";
import pageGallery from "./examples/page.gallery.json";
import pageHome from "./examples/page.home.json";
import pageOurPath from "./examples/page.our-path.json";

const raw = [
  aboutBlocks,
  blogStrip,
  contactSection,
  faq,
  galleryCards,
  heroArticle,
  heroBrand,
  introHeading,
  introText,
  photoStory,
  postList,
  teaserCollage,
] as unknown as SectionType[];

export const SECTION_TYPE_FIXTURES: Record<string, SectionType> = Object.fromEntries(raw.map((t) => [t.key, t]));
export const SECTION_TYPE_KEYS = Object.keys(SECTION_TYPE_FIXTURES);

export type ExampleSection = {
  page: string;
  index: number;
  section_type: string;
  variant: string | null;
  is_visible: boolean;
  props: Record<string, unknown>;
};

function sectionsOf(page: string, file: unknown): ExampleSection[] {
  const sections = (file as { sections: Array<Omit<ExampleSection, "page" | "index">> }).sections;
  return sections.map((s, index) => ({
    page,
    index,
    section_type: s.section_type,
    variant: s.variant,
    is_visible: s.is_visible,
    props: s.props,
  }));
}

export const EXAMPLE_SECTIONS: ExampleSection[] = [
  ...sectionsOf("home", pageHome),
  ...sectionsOf("our-path", pageOurPath),
  ...sectionsOf("blog", pageBlog),
  ...sectionsOf("gallery", pageGallery),
  ...sectionsOf("contact", pageContact),
];

export const DEFAULT_LOCALE_CODE = "la";
