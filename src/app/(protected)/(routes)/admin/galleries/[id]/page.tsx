import { notFound } from "next/navigation";

import { AlbumHost } from "@/components/protected/albums/album-host";

// /admin/galleries/[id] (SCR-29): the album editor. An album is created from the dialog of the list (T1.5.6), so there is no `new` route.
export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <AlbumHost id={Number(id)} />;
}
