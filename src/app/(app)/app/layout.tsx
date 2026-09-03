import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getAuthenticatedAccountSummary } from "@/lib/auth/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await getAuthenticatedAccountSummary();
  return <AppShell account={account}>{children}</AppShell>;
}
