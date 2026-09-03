import type { ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { AppShell } from "@/components/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
