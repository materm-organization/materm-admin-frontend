import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MediaThumb } from "@/components/protected/media/media-thumb";
import { renderWithIntl } from "@/test/render";

describe("MediaThumb", () => {
  it("shows the picture, cropped around the focal point", () => {
    renderWithIntl(<MediaThumb asset={{ url: "http://x/a.jpg", kind: "image", focal: { x: 0.25, y: 0.75 } }} alt="A hiker" />);
    const img = screen.getByRole("img", { name: "A hiker" }) as HTMLImageElement;
    expect(img.src).toBe("http://x/a.jpg");
    expect(img.style.objectPosition).toBe("25% 75%");
    expect(img.className).toContain("object-cover");
  });

  it("fill=false shows the whole picture (the focal picker's frame)", () => {
    renderWithIntl(<MediaThumb asset={{ url: "http://x/a.jpg" }} alt="a" fill={false} />);
    expect(screen.getByRole("img")).toHaveClass("object-contain");
  });

  it("no url: a placeholder that says why, never an <img src=''>", () => {
    const { container } = renderWithIntl(<MediaThumb asset={{ url: null, kind: "image" }} alt="x" />);
    expect(screen.getByText("No preview (file address not configured)")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("a picture the browser can not load (CSP, 404) is replaced by the placeholder", () => {
    renderWithIntl(<MediaThumb asset={{ url: "http://blocked/a.jpg", kind: "image" }} alt="x" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("The picture could not be loaded")).toBeInTheDocument();
  });

  it("files that are not pictures get a type placeholder", () => {
    renderWithIntl(<MediaThumb asset={{ url: "http://x/a.pdf", kind: "document", mime_type: "application/pdf" }} alt="doc" />);
    expect(screen.getByText("No preview")).toBeInTheDocument();
  });
});
