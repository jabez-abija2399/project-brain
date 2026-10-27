import { cn } from "@/lib/cn";

export const Button = ({ label }: { label: string }) => <button className={cn("btn")}>{label}</button>;
