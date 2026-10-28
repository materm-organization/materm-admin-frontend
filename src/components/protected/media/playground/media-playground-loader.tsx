"use client";

import dynamic from "next/dynamic";

// The playground (and the in-memory API behind it) is loaded only outside production builds; the dynamic import
// sits in a build-time-dead branch there, so no mock code reaches the production bundle.
const Playground =
  process.env.NODE_ENV === "production"
    ? null
    : dynamic(() => import("@/components/protected/media/playground/media-playground").then((m) => m.MediaPlayground), { ssr: false });

export function MediaPlaygroundLoader() {
  return Playground ? <Playground /> : null;
}
