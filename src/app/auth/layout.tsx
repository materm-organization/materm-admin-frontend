import React from "react";

interface Props {
  children: React.ReactNode;
}

// Grid-pattern backdrop, scoped to just `/auth/*` since this app has no
// other public route group.
export default function AuthLayout({ children }: Props) {
  return (
    <>
      <div className="absolute inset-0 h-full bg-[linear-gradient(to_right,#e5e7eb_1px,transparent_1px),linear-gradient(to_bottom,#e5e7eb_1px,transparent_1px)] bg-size-[3rem_3rem] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)] dark:bg-[linear-gradient(to_right,#374151_1px,transparent_1px),linear-gradient(to_bottom,#374151_1px,transparent_1px)]" />
      <main className="relative z-0 mx-auto w-full">{children}</main>
    </>
  );
}
