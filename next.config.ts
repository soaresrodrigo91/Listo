import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/mobile", destination: "/mobile/index.html" }];
  },
};

export default nextConfig;
