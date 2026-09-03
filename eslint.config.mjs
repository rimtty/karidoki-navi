import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Supabase Edge Functions are checked by the Supabase/Deno toolchain;
    // their remote imports and Deno globals are not part of the Next bundle.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
