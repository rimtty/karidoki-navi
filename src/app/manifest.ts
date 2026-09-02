import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "刈りどきナビ",
    short_name: "刈りどきナビ",
    description:
      "田んぼの積算気温を自動計算し、次に刈る田んぼがひと目で分かるWebアプリ",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5eb",
    theme_color: "#315c2b",
    lang: "ja",
  };
}
