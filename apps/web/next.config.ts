import type { NextConfig } from "next";

const explicitDistDir = process.env.NEXT_DIST_DIR?.trim();
const isProduction = process.env.NODE_ENV === "production";
const distDir = explicitDistDir || (isProduction ? ".next-prod" : ".next-dev");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep dev/build artifacts isolated to avoid stale chunk references
  // when switching modes or running multiple Next commands.
  distDir,
  webpack(config, { dev }) {
    if (dev) {
      // Avoid dev-server instability caused by transient missing pack files
      // under .next-dev/cache/webpack on local restarts.
      config.cache = false;
    }
    return config;
  }
};

export default nextConfig;
