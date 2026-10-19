import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // db/schema.sql is read at runtime by ensureSchema(); make sure serverless bundles (Vercel) include it.
  outputFileTracingIncludes: {
    "/*": ["./db/schema.sql"],
  },
};

export default nextConfig;
