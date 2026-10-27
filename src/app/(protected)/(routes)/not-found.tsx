import { NotFoundState } from "@/components/global/states/not-found-state";

// Rendered inside the protected shell when a page under it calls `notFound()` (e.g. a detail page whose GET
// answered 404 `NOT_FOUND`).
export default function RoutesNotFound() {
  return <NotFoundState />;
}
