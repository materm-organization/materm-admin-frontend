import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaThumb } from "@/components/protected/media/media-thumb";
import { renderWithIntl } from "@/test/render";

type Cb = (entries: Array<{ isIntersecting: boolean }>) => void;
let observers: Array<{ cb: Cb; el: Element | null }> = [];
const OriginalIO = window.IntersectionObserver;

class FakeIO {
  el: Element | null = null;
  constructor(public cb: Cb) {
    observers.push(this as unknown as { cb: Cb; el: Element | null });
  }
  observe(el: Element) {
    this.el = el;
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function intersectAll() {
  act(() => {
    for (const o of observers) o.cb([{ isIntersecting: true }]);
  });
}

const video = { url: "http://media/v.mp4", kind: "video", mime_type: "video/mp4", duration_ms: 34000 };

beforeEach(() => {
  observers = [];
  window.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
});
afterEach(() => {
  window.IntersectionObserver = OriginalIO;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MediaThumb video first frame", () => {
  it("mounts no <video> until the tile is near the viewport", () => {
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("Video")).toBeInTheDocument();
  });

  it("after intersection a muted, paused, control-less <video> with #t=0.1 and no crossorigin appears", () => {
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    intersectAll();
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(v.getAttribute("src")).toBe("http://media/v.mp4#t=0.1");
    expect(v.muted).toBe(true);
    expect(v).toHaveAttribute("preload", "metadata");
    expect(v).not.toHaveAttribute("controls");
    expect(v).not.toHaveAttribute("crossorigin");
    expect(v).not.toHaveAttribute("autoplay");
    expect(v).toHaveAttribute("tabindex", "-1");
    expect(v).toHaveClass("object-cover");
    fireEvent.loadedData(v);
    expect(v).toHaveClass("opacity-100");
  });

  it("badges stay on top", () => {
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    intersectAll();
    expect(container.querySelector("[data-slot=video-play-badge]")).not.toBeNull();
    expect(container.querySelector("[data-slot=video-duration-badge]")).toHaveTextContent("0:34");
  });

  it("an error falls back to the icon placeholder", () => {
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    intersectAll();
    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("Video")).toBeInTheDocument();
    expect(container.querySelector("[data-slot=video-play-badge]")).not.toBeNull();
  });

  it("a frame that never arrives falls back after 8 s", () => {
    vi.useFakeTimers();
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    intersectAll();
    expect(container.querySelector("video")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(8100);
    });
    expect(container.querySelector("video")).toBeNull();
  });

  it("url null stays on the icon", () => {
    const { container } = renderWithIntl(<MediaThumb asset={{ ...video, url: null }} alt="clip" />);
    intersectAll();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-slot=video-play-badge]")).not.toBeNull();
  });

  it("no H.264 support keeps the icon", () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    intersectAll();
    expect(container.querySelector("video")).toBeNull();
  });

  it("reduced-data preference keeps the icon", () => {
    const mm = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("prefers-reduced-data"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    const { container } = renderWithIntl(<MediaThumb asset={video} alt="clip" />);
    intersectAll();
    expect(container.querySelector("video")).toBeNull();
    mm.mockRestore();
  });

  it("caps concurrent frame loads at 3; the 4th waits until one is done", () => {
    const { container } = renderWithIntl(
      <div>
        {[1, 2, 3, 4].map((i) => (
          <MediaThumb key={i} asset={{ ...video, url: `http://media/${i}.mp4` }} alt={`c${i}`} />
        ))}
      </div>,
    );
    intersectAll();
    expect(container.querySelectorAll("video")).toHaveLength(3);
    fireEvent.loadedData(container.querySelectorAll("video")[0]);
    expect(container.querySelectorAll("video")).toHaveLength(4);
  });

  it("the 4th also proceeds when one of the first fails", () => {
    const { container } = renderWithIntl(
      <div>
        {[1, 2, 3, 4].map((i) => (
          <MediaThumb key={i} asset={{ ...video, url: `http://media/${i}.mp4` }} alt={`c${i}`} />
        ))}
      </div>,
    );
    intersectAll();
    fireEvent.error(container.querySelectorAll("video")[1]);
    expect(container.querySelectorAll("video")).toHaveLength(3);
    expect(container.querySelector('video[src="http://media/4.mp4#t=0.1"]')).not.toBeNull();
  });

  it("image tiles are unchanged", () => {
    const { container } = renderWithIntl(<MediaThumb asset={{ url: "http://x/a.jpg", kind: "image" }} alt="pic" />);
    intersectAll();
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("img", { name: "pic" })).toHaveAttribute("src", "http://x/a.jpg");
  });
});
