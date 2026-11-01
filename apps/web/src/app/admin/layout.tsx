import { ShellLayout } from "@/app/shell-layout";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
