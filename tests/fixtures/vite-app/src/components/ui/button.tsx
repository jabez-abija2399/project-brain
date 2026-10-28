import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Button = ({ children }: { children: ReactNode }) => <button className={cn("btn")}>{children}</button>;
