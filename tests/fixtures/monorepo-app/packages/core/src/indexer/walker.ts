import { parse } from "./parser";

export function walk(root: string): string[] {
  return [parse(root)];
}
