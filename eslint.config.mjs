import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ajv standalone output (scripts/generate-schema-validators.mjs).
    "src/components/schema-form/precompiled/validators.generated.js",
  ]),
  {
    // shadcn's current codegen output (components/ui/sidebar.tsx's random
    // skeleton-row width, hooks/use-mobile.ts's setState-in-effect) predates
    // the newer react-hooks/purity and react-hooks/set-state-in-effect
    // rules and trips them as-generated. These files are treated as
    // semi-generated — avoid hand-editing them
    // to satisfy a lint rule shadcn itself hasn't caught up with yet;
    // downgrade just these two rules, just here, instead.
    files: ["src/components/ui/**", "src/hooks/use-mobile.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;
