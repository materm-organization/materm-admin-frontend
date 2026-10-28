import { getTranslations } from "next-intl/server";

import { MediaLibrary } from "@/components/protected/media/media-library";

// /admin/media (SCR-35, SCR-36) - the route guard requires `read` on `media.library` (lib/nav-main-items.ts).
// No upload button: uploads are P2 (the rows are the seeded `static/...` assets).
export default async function MediaPage() {
  const t = await getTranslations("media");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      <MediaLibrary />
    </div>
  );
}
