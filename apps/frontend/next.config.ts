import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Expose VERSION from .env.local to client-side as NEXT_PUBLIC_VERSION
    NEXT_PUBLIC_VERSION: process.env.VERSION ?? '1.1.2',
    NEXT_PUBLIC_BBS_VERSION: process.env.BBS_VERSION ?? 'v0.18b',
  },
  /*
   * The videos are static downloads, served from the CDN like the rest of
   * public/. The OG image route reads public/ by a runtime path, so the tracer
   * copied every mp4 (~384MB) into the [app] functions and broke Vercel's
   * 250MB function limit. No function ever reads an mp4, or Zecamp's mp3s.
   */
  outputFileTracingExcludes: {
    '*': ['public/**/*.mp4', 'public/**/*.mp3'],
  },
};

export default nextConfig;
