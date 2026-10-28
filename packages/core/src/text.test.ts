import { describe, expect, it } from "vitest";
import { UNSAFE_TEXT_CHARS, oneLineText } from "./text";

const char = (code: number) => String.fromCharCode(code);

describe("oneLineText (FEAT-012 security pass)", () => {
  it("AC-012-07 attack: NUL, ESC, BEL, NEL, line separators and bidi overrides cannot survive into one line", () => {
    const nasty = [
      "a",
      char(0),
      "b",
      `${char(0x1b)}[2J`,
      "c",
      char(7),
      "d",
      char(0x85),
      "e",
      char(0x2028),
      "f",
      char(0x202e),
      "g",
    ].join("");
    const out = oneLineText(nasty);
    expect(out).toBe("a b [2Jc d e f g");
    expect(new RegExp(`[${UNSAFE_TEXT_CHARS}]`).test(out)).toBe(false);
  });
});
