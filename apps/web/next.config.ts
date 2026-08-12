import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE_URL: process.env.SOCIAL_AGENT_SUPABASE_URL,
    NEXT_PUBLIC_SOCIAL_AGENT_SUPABASE_ANON_KEY: process.env.SOCIAL_AGENT_SUPABASE_ANON_KEY,
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
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
