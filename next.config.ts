import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "node-cron"],
  images: { unoptimized: true },
};

export default nextConfig;
