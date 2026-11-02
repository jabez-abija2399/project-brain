// The entry the native binaries are compiled from (D-027; `bun build --compile`, build-native.mjs). The npm build and
// the tests use main.ts directly. It embeds PGlite's WebAssembly and data, records the build target, and serves the
// SQL sandbox child (`codeceipt __sandbox-child`), which only answers one job on stdin and never starts a process.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import initdbPath from "../node_modules/@electric-sql/pglite/dist/initdb.wasm" with {
  type: "file",
};
import cryptoPath from "../node_modules/@electric-sql/pglite/dist/pgcrypto.tar.gz" with {
  type: "file",
};
import dataPath from "../node_modules/@electric-sql/pglite/dist/pglite.data" with { type: "file" };
import wasmPath from "../node_modules/@electric-sql/pglite/dist/pglite.wasm" with { type: "file" };
import uuidPath from "../node_modules/@electric-sql/pglite/dist/uuid-ossp.tar.gz" with {
  type: "file",
};
import type { Target } from "./native/release";

// Replaced at build time with this binary's target (build-native.mjs --define).
declare const __CODECEIPT_TARGET__: string;

if (process.argv[2] === "__sandbox-child") {
  // The sandbox child: PGlite gets its WebAssembly and data from inside this binary. PGlite opens extension bundles
  // through a file URL, which the embedded file system does not serve, so the two small bundles are copied to a
  // private temporary folder first (removed when the job ends).
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { uuid_ossp } = await import("@electric-sql/pglite/contrib/uuid_ossp");
  const { serveStdioJob } = await import("../../sandbox/src/stdio-child.mjs");
  const dir = mkdtempSync(join(tmpdir(), "codeceipt-sandbox-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const unpacked = (from: string, name: string) => {
    const to = join(dir, name);
    writeFileSync(to, readFileSync(from), { mode: 0o600 });
    return pathToFileURL(to);
  };
  type Ext = {
    name: string;
    setup: (pg: unknown, opts: unknown) => Promise<Record<string, unknown>>;
  };
  const withBundle = (ext: Ext, bundlePath: URL): Ext => ({
    name: ext.name,
    setup: async (pg, opts) => ({ ...(await ext.setup(pg, opts)), bundlePath }),
  });
  await serveStdioJob({
    pgliteWasmModule: await WebAssembly.compile(readFileSync(wasmPath)),
    initdbWasmModule: await WebAssembly.compile(readFileSync(initdbPath)),
    fsBundle: new Blob([readFileSync(dataPath)]),
    extensions: {
      pgcrypto: withBundle(pgcrypto as unknown as Ext, unpacked(cryptoPath, "pgcrypto.tar.gz")),
      uuid_ossp: withBundle(uuid_ossp as unknown as Ext, unpacked(uuidPath, "uuid-ossp.tar.gz")),
    },
  });
} else {
  const { setNativeBuild } = await import("./native/install-info");
  const { setSandboxChildCommand } = await import("@brain/sandbox");
  setNativeBuild({ target: __CODECEIPT_TARGET__ as Target });
  setSandboxChildCommand({ command: process.execPath, args: ["__sandbox-child"] });
  // Windows: an update moved the previous binary aside; it can be removed once that run has ended.
  if (process.platform === "win32") rmSync(`${process.execPath}.old`, { force: true });
  await import("./main");
}
