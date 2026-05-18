import type { NextConfig } from "next";

// INTERNAL_BACKEND_URL: used only by Next.js server-side rewrites.
// In Docker this is the backend container name (http://genfy-backend:8001).
// Locally this is http://localhost:8000.
// NEXT_PUBLIC_API_URL is used by the browser — set to the domain in prod.
const internalBackendUrl =
  process.env.INTERNAL_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: false,
  // Keep TCP connections alive to the backend so long Gemini calls don't get ECONNRESET
  httpAgentOptions: {
    keepAlive: true,
  },
  experimental: {
    proxyClientMaxBodySize: "50mb",
    // 5-minute proxy timeout — enough for even the longest 4K Gemini generations
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalBackendUrl}/api/:path*`,
      },
      {
        source: "/auth/:path*",
        destination: `${internalBackendUrl}/auth/:path*`,
      },
      {
        source: "/exports/:path*",
        destination: `${internalBackendUrl}/exports/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.klingai.com" },
      { protocol: "https", hostname: "**.cdn-cn.com" },
      { protocol: "https", hostname: "**.kwaicdn.com" },
      { protocol: "https", hostname: "p1.a.kwimgs.com" },
      { protocol: "https", hostname: "i.klingai.com" },
    ],
  },
};

export default nextConfig;
