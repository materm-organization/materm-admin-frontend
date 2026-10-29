import { notFound } from "next/navigation";

import { PostHost } from "@/components/protected/posts/post-host";

// /admin/blog/posts/[id] (SCR-25): the post editor. A post is created from the dialog of the list (T1.5.5), so there is no `new` route.
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) notFound();
  return <PostHost id={Number(id)} />;
}
