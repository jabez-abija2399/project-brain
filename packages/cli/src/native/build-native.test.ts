import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS build script without type declarations
import { bunExecutable } from "../../build-native.mjs";

// The cli-v0.3.0 release failed on Windows: `npm install -g bun` leaves only bun.cmd/bun.ps1 on PATH, which a
// shell-less execFileSync("bun") cannot start. The build now runs the real bun.exe.
describe("native build: which bun to run", () => {
  it("runs `bun` from PATH on Linux and macOS", () => {
    expect(bunExecutable({ PATH: "/usr/bin" }, "linux", () => false)).toBe("bun");
    expect(bunExecutable({ PATH: "/usr/bin" }, "darwin", () => false)).toBe("bun");
  });

  it("on Windows finds bun.exe next to the npm launcher, never the .cmd shim", () => {
    const npmPrefix = "C:\\npm\\prefix";
    const exe = win32.join(npmPrefix, "node_modules", "bun", "bin", "bun.exe");
    const env = { PATH: ["C:\\Windows", npmPrefix].join(win32.delimiter) };
    expect(bunExecutable(env, "win32", (p: string) => p === exe)).toBe(exe);
  });

  it("on Windows prefers a bun.exe directly on PATH, and BUN_PATH wins over both", () => {
    const direct = win32.join("C:\\bun", "bun.exe");
    expect(bunExecutable({ PATH: "C:\\bun" }, "win32", (p: string) => p === direct)).toBe(direct);
    expect(
      bunExecutable({ BUN_PATH: "D:\\tools\\bun.exe", PATH: "C:\\bun" }, "win32", () => true),
    ).toBe("D:\\tools\\bun.exe");
  });

  it("on Windows without bun.exe it says how to install it", () => {
    expect(() => bunExecutable({ PATH: "C:\\Windows" }, "win32", () => false)).toThrow(
      /npm install -g bun/,
    );
  });
});
