import { builtinModules } from "node:module"

import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

// Module boundaries (§3.1). `lib/engine` is pure: no I/O, framework or DB.
const engineBoundary = {
  files: ["lib/engine/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        // Bare built-in names are exact matches: as patterns they would also
        // match local files such as `./constants`.
        paths: builtinModules.map((name) => ({
          name,
          message: "lib/engine has no I/O.",
        })),
        patterns: [
          {
            group: [
              "@/lib/db",
              "@/lib/db/**",
              "@/lib/dal",
              "@/lib/dal/**",
              "**/db",
              "**/db/**",
              "**/dal",
              "**/dal/**",
            ],
            message: "lib/engine must not import lib/db or lib/dal.",
          },
          {
            group: [
              "next",
              "next/**",
              "react",
              "react/**",
              "react-dom",
              "react-dom/**",
              // UI code that pulls React in:
              "@/app/**",
              "@/components/**",
              "@/hooks/**",
              "**/app/**",
              "**/components/**",
              "**/hooks/**",
              "@base-ui/**",
              "lucide-react",
              "next-themes",
              "sonner",
            ],
            message: "lib/engine must not import Next.js, React or UI code.",
          },
          {
            group: [
              "node:*",
              ...builtinModules.map((m) => `${m}/**`),
              "server-only",
              "better-sqlite3",
              "drizzle-orm",
              "drizzle-orm/**",
            ],
            message: "lib/engine has no I/O.",
          },
          {
            // Callers pass in `today` and `now`; content arrives as arguments.
            // The schema types and `normalizeAnswer` stay importable.
            group: [
              "@/lib/clock",
              "**/clock",
              "@/lib/auth",
              "@/lib/auth/**",
              "**/auth",
              "**/auth/**",
              "@/lib/content/load",
              "@/lib/content/render",
              "**/content/load",
              "**/content/render",
            ],
            message: "lib/engine has no clock, auth or content loading.",
          },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      { name: "fetch", message: "lib/engine has no I/O." },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "ImportExpression",
        message: "lib/engine has no dynamic imports.",
      },
      {
        selector:
          "MemberExpression[object.name='Date'][property.name='now'], NewExpression[callee.name='Date'][arguments.length=0]",
        message:
          "lib/engine has no clock: take `now` or `today` as an argument.",
      },
      {
        selector: "MemberExpression[object.name='process']",
        message: "lib/engine reads no environment: take values as arguments.",
      },
    ],
  },
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  engineBoundary,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test output:
    "playwright-report/**",
    "test-results/**",
    // Other sessions' worktrees:
    ".claude/**",
  ]),
])

export default eslintConfig
