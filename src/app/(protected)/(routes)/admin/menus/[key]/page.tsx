import { notFound } from "next/navigation";

import { MenuEditor } from "@/components/protected/menus/menu-editor";

// /admin/menus/[key] (SCR-18): the menu tree editor. `{key}` is `^[a-z][a-z0-9_]{0,39}$` (doc/05 section 11.2).
export default async function MenuPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) notFound();
  return <MenuEditor menuKey={key} />;
}
