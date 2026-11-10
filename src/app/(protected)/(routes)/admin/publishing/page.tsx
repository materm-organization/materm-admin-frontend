import { PublishingQueueScreen } from "@/components/protected/publishing/publishing-queue";

// /admin/publishing (SCR-39): the publishing queue. Open to a person who may read at least one publishable kind (`lib/nav-main-items.ts`); the
// server leaves out every kind they may not read.
export default function PublishingQueuePage() {
  return <PublishingQueueScreen />;
}
