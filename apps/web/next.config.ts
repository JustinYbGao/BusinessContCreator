import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@social-agent/contracts",
    "@social-agent/db",
    "@social-agent/product-core",
    "@social-agent/llm",
    "@social-agent/topic-engine",
    "@social-agent/content-engine",
    "@social-agent/review-engine",
    "@social-agent/analytics",
  ],
};

export default nextConfig;
