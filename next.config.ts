import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/maplibre-gl-worker.mjs": [
      "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
      "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
    ],
    "/maplibre-gl-shared.mjs": [
      "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
    ],
  },
};

export default nextConfig;
