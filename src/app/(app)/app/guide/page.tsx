import type { Metadata } from "next";
import { GuideView } from "@/features/guide/guide-view";

export const metadata: Metadata = {
  title: "使い方 | 刈りどきナビ",
};

export default function GuidePage() {
  return <GuideView />;
}
