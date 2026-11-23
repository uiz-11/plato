import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  // Content and migrations are read from disk at request time and at start-up,
  // so the tracer cannot see them. The globs name only what the app loads:
  // pipeline evidence in `_audit/` must stay out of the image (§5.1), and
  // `outputFileTracingExcludes` does not remove files added here.
  outputFileTracingIncludes: {
    "/*": [
      "./content/*.json",
      "./content/courses/*/course.yaml",
      "./content/courses/*/lessons/**",
      "./content/courses/*/assets/**",
      "./lib/db/migrations/**",
    ],
  },
}

export default nextConfig
