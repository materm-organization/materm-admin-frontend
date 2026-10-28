// The structure rules of a page template, client side (doc/05 12.5.5, doc/07 SCR-20, doc/04 3.2): where a section may be
// added and which orders are refused. The server checks them again (422 `template_violation`); these keep the
// obvious mistakes from being sent and decide what the add dialog offers.
import type { PageTemplate, SectionSummary, TemplateSection } from "@/types/pages";

export type StructureRule = "hero_first" | "after_hero" | "max_per_page" | "section_not_allowed";

type Keyed = { section_type: { key: string } };
const keyOf = (s: Keyed) => s.section_type.key;

export const isHero = (template: PageTemplate | undefined, key: string) => template?.allowed_sections.find((s) => s.section_type_key === key)?.group === "hero";

// First broken rule of an order (section type keys, top to bottom), or null.
export function orderProblem(template: PageTemplate | undefined, keys: string[]): StructureRule | null {
  if (!template) return null;
  const hero = keys.findIndex((k) => isHero(template, k));
  for (const [index, key] of keys.entries()) {
    const place = template.allowed_sections.find((s) => s.section_type_key === key);
    if (!place) return "section_not_allowed";
    if (place.position === "first" && index !== 0) return "hero_first";
    if (place.position === "after_hero" && hero >= 0 && index < hero) return "after_hero";
  }
  return null;
}

export type AddOption = {
  type: TemplateSection;
  // Why it can not be added now (null = it can).
  disabledReason: "max" | null;
  max: number | null;
};

// How many sections of this type (a hero counts the whole hero group) the page has.
export function countFor(template: PageTemplate | undefined, sections: Array<Keyed>, place: TemplateSection): number {
  if (place.group) {
    const group = new Set(template?.allowed_sections.filter((s) => s.group === place.group).map((s) => s.section_type_key));
    return sections.filter((s) => group.has(keyOf(s))).length;
  }
  return sections.filter((s) => keyOf(s) === place.section_type_key).length;
}

export function addOptions(template: PageTemplate | undefined, sections: Array<Keyed>): AddOption[] {
  return (template?.allowed_sections ?? [])
    .filter((s) => s.is_active && s.code_registered)
    .map((type) => ({
      type,
      max: type.max_per_page,
      disabledReason: type.max_per_page !== null && countFor(template, sections, type) >= type.max_per_page ? ("max" as const) : null,
    }));
}

// The position a new section gets: a hero goes to the top, a section that has to follow the hero goes below it.
export function resolvePosition(template: PageTemplate | undefined, sections: Array<Keyed>, typeKey: string, wanted: number): number {
  const place = template?.allowed_sections.find((s) => s.section_type_key === typeKey);
  const clamped = Math.max(0, Math.min(wanted, sections.length));
  if (!place) return clamped;
  if (place.position === "first") return 0;
  if (place.position === "after_hero") {
    const hero = sections.findIndex((s) => isHero(template, keyOf(s)));
    if (hero >= 0) return Math.max(clamped, hero + 1);
  }
  // Nothing goes above a hero.
  if (sections.length > 0 && isHero(template, keyOf(sections[0])) && !place.group) return Math.max(clamped, 1);
  return clamped;
}

// What the template asks for (05 12.4 `required`), with whether the page has it already.
export type RequirementState = { key: string; kind: "group" | "type"; label: string[]; met: boolean };

export function requirementStates(template: PageTemplate | undefined, sections: Array<Keyed | SectionSummary>): RequirementState[] {
  return (template?.required ?? []).map((r) => ({
    key: r.kind === "group" ? `group:${r.group}` : `type:${r.section_type_keys.join(",")}`,
    kind: r.kind,
    label: r.section_type_keys,
    met: sections.filter((s) => r.section_type_keys.includes(keyOf(s))).length >= r.min,
  }));
}
