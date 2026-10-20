import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project so Next's lockfile
  // root-inference can't pick up an unrelated package-lock.json in a parent
  // directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default withNextIntl(nextConfig);
