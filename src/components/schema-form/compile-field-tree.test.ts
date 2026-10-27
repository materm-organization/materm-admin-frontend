import { describe, expect, it } from "vitest";

import { compileFieldTree, findNodeByPointer, isShown, type FieldTree } from "./compile-field-tree";
import { SECTION_TYPE_FIXTURES, SECTION_TYPE_KEYS } from "./fixtures";
import type { FieldNode } from "./types";

const treeOf = (key: string): FieldTree =>
  compileFieldTree(SECTION_TYPE_FIXTURES[key].json_schema, SECTION_TYPE_FIXTURES[key].ui_schema);
const child = (node: FieldNode, name: string) => {
  const found = node.children.find((c) => c.name === name);
  if (!found) throw new Error(`no child ${name}`);
  return found;
};

describe("compileFieldTree", () => {
  it("gives every property of all 12 schemas a widget (nothing falls back to JSON)", () => {
    for (const key of SECTION_TYPE_KEYS) {
      const tree = treeOf(key);
      expect(tree.warnings, key).toEqual([]);
      const unknown: string[] = [];
      const visit = (n: FieldNode) => {
        if (n.kind === "unknown") unknown.push(n.schemaPointer);
        n.children.forEach(visit);
        if (n.item) visit(n.item);
      };
      visit(tree.root);
      expect(unknown, key).toEqual([]);
    }
  });

  it("orders properties by ui:order, the rest in schema order", () => {
    const hero = treeOf("hero_brand").root;
    expect(hero.children.map((c) => c.name)).toEqual(["title", "description", "cta", "background", "show_logo", "animate_in"]);
    const about = treeOf("about_blocks").root;
    expect(about.children[0].item?.children.map((c) => c.name)).toEqual([
      "date_label", "title", "body", "image", "image_side", "layout", "image_ratio",
    ]);
  });

  it("maps shapes to widgets (doc/07 section 4.2)", () => {
    const hero = treeOf("hero_brand").root;
    const title = child(hero, "title");
    expect(title.kind).toBe("localized-text");
    expect(title.textarea).toBe(true);
    expect(title.options.rows).toBe(2);
    expect(title.maxLength).toBe(80);
    expect(title.required).toBe(true);
    const cta = child(hero, "cta");
    expect(cta.kind).toBe("object");
    expect(cta.defName).toBe("cta");
    expect(cta.optionalGroup).toBe(true);
    expect(child(cta, "link").kind).toBe("link");
    expect(child(hero, "background").kind).toBe("image");
    expect(child(hero, "background").options.ratio).toBe("hero");
    expect(child(hero, "show_logo").kind).toBe("boolean");
    expect(child(hero, "show_logo").defaultValue).toBe(true);
  });

  it("recognises x-ref pickers, enums, numbers, rich text and arrays", () => {
    const gallery = treeOf("gallery_cards").root;
    expect(child(gallery, "source").kind).toBe("enum");
    expect(child(gallery, "album_id").entity).toMatchObject({ kind: "album", valueType: "number" });
    expect(child(gallery, "limit")).toMatchObject({ kind: "number", integer: true, minimum: 1, maximum: 9 });
    const cards = child(gallery, "cards");
    expect(cards).toMatchObject({ kind: "array", minItems: 1, maxItems: 9 });
    expect(cards.item?.kind).toBe("object");
    expect(child(cards.item as FieldNode, "caption").optionalGroup).toBe(true);

    expect(child(treeOf("faq").root, "group_key").entity).toMatchObject({ kind: "faqGroup", valueType: "string" });
    expect(child(treeOf("contact_section").root, "form_slug").entity).toMatchObject({ kind: "form", valueType: "string" });
    expect(child(treeOf("blog_strip").root, "category_id").entity?.kind).toBe("category");

    const body = child((child(treeOf("about_blocks").root, "items").item as FieldNode), "body");
    expect(body).toMatchObject({ kind: "richtext", richtextProfile: "lite" });
    expect(child(treeOf("intro_text").root, "text")).toMatchObject({ kind: "richtext" });
    const side = child(child(treeOf("about_blocks").root, "items").item as FieldNode, "image_side");
    expect(side).toMatchObject({ kind: "enum", radio: true, enumValues: ["left", "right"] });
  });

  it("reads ui:options of arrays and the album field of an album item picker", () => {
    const images = child(treeOf("teaser_collage").root, "images");
    expect(images.options).toMatchObject({ orderable: true, addable: false, removable: false });
    expect(images).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(images.item?.kind).toBe("image");
    const slots = child(child(treeOf("photo_story").root, "rows").item as FieldNode, "slots");
    const pick = child(slots.item as FieldNode, "album_item_id");
    expect(pick.entity?.kind).toBe("albumItem");
    expect(pick.options.albumField).toBe("/album_id");
  });

  it("evaluates ui:showIf against sibling values", () => {
    const gallery = treeOf("gallery_cards").root;
    const albumId = child(gallery, "album_id");
    expect(albumId.showIf).toEqual({ source: "album" });
    expect(isShown(albumId, { source: "album" })).toBe(true);
    expect(isShown(albumId, { source: "manual" })).toBe(false);
    expect(isShown(albumId, undefined)).toBe(false);
    expect(isShown(child(gallery, "title"), {})).toBe(true);
  });

  it("falls back to an 'unknown' node for a shape it cannot render", () => {
    const tree = compileFieldTree({ type: "object", properties: { odd: { oneOf: [{ type: "string" }, { type: "number" }] } } }, {});
    expect(child(tree.root, "odd").kind).toBe("unknown");
    expect(tree.warnings).toHaveLength(1);
  });

  it("finds the node of a JSON Pointer: array items, locale under a localized node", () => {
    const tree = treeOf("about_blocks");
    const found = findNodeByPointer(tree, ["items", "1", "title", "la"]);
    expect(found?.node.kind).toBe("localized-text");
    expect(found?.locale).toBe("la");
    expect(found?.itemIndexes).toEqual([{ pointer: "/items/1", index: 1 }]);
    expect(findNodeByPointer(tree, ["nope"])).toBeUndefined();
    const hero = treeOf("hero_brand");
    expect(findNodeByPointer(hero, ["background", "alt", "en"])).toMatchObject({ locale: "en" });
    expect(findNodeByPointer(hero, ["cta", "link", "url"])?.node.kind).toBe("link");
  });
});
