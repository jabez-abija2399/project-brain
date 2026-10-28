import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readHiddenLine } from "./prompt";

function tty() {
  const input = Object.assign(new PassThrough(), { setRawMode: vi.fn() });
  const written: string[] = [];
  return { input, written, write: (s: string) => written.push(s) };
}

describe("FEAT-008 L1 the login prompt hides the token", () => {
  it("reads one line in raw mode without echoing it, handles backspace, then restores the terminal", async () => {
    const t = tty();
    const line = readHiddenLine(t.input, t.write);
    expect(t.input.setRawMode).toHaveBeenCalledWith(true);
    t.input.write("pb_secret-tokx");
    t.input.write("\u007fen\r");
    expect(await line).toBe("pb_secret-token");
    expect(t.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(t.written.join("")).not.toContain("pb_");
    expect(t.written).toEqual(["\n"]);
  });

  it("Ctrl-C cancels the prompt and restores the terminal", async () => {
    const t = tty();
    const line = readHiddenLine(t.input, t.write);
    t.input.write("pb_x\u0003");
    await expect(line).rejects.toThrow("Login cancelled.");
    expect(t.input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
