import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["rss-parser", "cheerio"],
  async redirects() {
    return [
      // /history was renamed to /archive on 2026-06-03. Permanent so
      // external links, search engines, and Vercel Analytics history
      // all converge on the new URL.
      { source: "/history", destination: "/archive", permanent: true },
      { source: "/history/:date", destination: "/archive/:date", permanent: true },
    ];
  },
};

export default nextConfig;
