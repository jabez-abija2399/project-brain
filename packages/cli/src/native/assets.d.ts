// Files embedded in the native binary (native-main.ts): `import p from "…" with { type: "file" }` gives their path.
declare module "*.wasm" {
  const path: string;
  export default path;
}
declare module "*.data" {
  const path: string;
  export default path;
}
declare module "*.tar.gz" {
  const path: string;
  export default path;
}
declare module "*/stdio-child.mjs" {
  export function serveStdioJob(pg?: Record<string, unknown>): Promise<void>;
}
