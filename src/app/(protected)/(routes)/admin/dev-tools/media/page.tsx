import { notFound } from "next/navigation";

import { MediaPlaygroundLoader } from "@/components/protected/media/playground/media-playground-loader";

// /admin/dev-tools/media - manual playground of T1.3.9: MediaPicker (single / multiple), RevisionsTab on a media
// asset / a menu / a settings group, the cache purge card. Development only (not-found in a production build, not
// in the navigation; the route is covered by the `/admin/dev-tools` entry of lib/nav-main-items.ts). The backend
// endpoints are written in parallel, so it talks to the in-memory API in src/mocks/.
export default function MediaPlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MediaPlaygroundLoader />;
}
