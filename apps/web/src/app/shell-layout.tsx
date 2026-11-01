import { AppShell } from "@/components/shell/app-shell";
import { shellData } from "@/server/shell";
import type { ReactNode } from "react";

// The shared app shell for every signed-in section: header with the project switcher and sign out, and the landing
// page's footer.
export async function ShellLayout({ children }: { children: ReactNode }) {
  const data = await shellData();
  return <AppShell {...data}>{children}</AppShell>;
}
