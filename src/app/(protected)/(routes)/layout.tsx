"use client";

import { AppSidebar } from "@/components/navbar/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { RoutePermissionGuard } from "@/components/layout/route-permission-guard";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useWorkspaceInitializer } from "@/hooks/use-workspace-initializer";

// Composes, in order: SidebarProvider -> context-initializer hook ->
// AppSidebar -> header -> RoutePermissionGuard wrapping {children}. This is a
// client-side-only route group — there is no edge `middleware.ts` gate.
export default function ProtectedRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useWorkspaceInitializer();

  return (
    <SidebarProvider>
      <AppSidebar />
      {/* `min-w-0` is load-bearing here — without it a flex child won't
          shrink below its content's intrinsic width, which is what lets a
          wide table force the whole inset card wider than the viewport
          instead of scrolling internally. */}
      <SidebarInset className="min-w-0">
        <AppHeader />
        <main className="min-w-0 flex-1 overflow-x-auto px-2 py-4 md:px-8 md:py-4">
          <RoutePermissionGuard>{children}</RoutePermissionGuard>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
