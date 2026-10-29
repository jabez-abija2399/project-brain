// FEAT-018: reads JS/TS test source without running it. One linear pass blanks comments and the contents of strings,
// template literals and regex literals (positions and line breaks are kept), so commented-out tests, decoy
// expect( inside strings and wrapped calls cannot fool the checks. Pure.

export type Source = {
  // Comments and string/regex contents replaced by spaces; quotes kept.
  code: string;
  // Comments blanked, strings kept (for it["only"] and similar).
  noComments: string;
  // Opening quote index -> closing quote index of every string or template literal.
  strings: Map<number, number>;
};

const REGEX_BEFORE = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

export function readSource(text: string): Source {
  const code = text.split("");
  const noComments = text.split("");
  const strings = new Map<number, number>();
  const blank = (from: number, to: number, alsoNoComments: boolean) => {
    for (let k = from; k < to; k++) {
      const ch = text[k];
      if (ch === "\n" || ch === "\r") continue;
      code[k] = " ";
      if (alsoNoComments) noComments[k] = " ";
    }
  };
  let prev = ""; // last significant code character, to tell a regex literal from a division
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop, true);
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop, true);
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && text[j] !== ch) {
        if (text[j] === "\\") j++;
        else if (ch !== "`" && (text[j] === "\n" || text[j] === "\r")) break;
        j++;
      }
      strings.set(i, Math.min(j, n));
      blank(i + 1, Math.min(j, n), false);
      i = j + 1;
      prev = ch;
    } else if (ch === "/" && REGEX_BEFORE.has(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== "\n") {
        const c = text[j];
        if (c === "\\") j++;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        j++;
      }
      blank(i + 1, Math.min(j, n), false);
      i = j + 1;
      prev = "/";
    } else {
      if (!/\s/.test(ch)) prev = /[\w$)\]]/.test(ch) ? "x" : ch;
      i++;
    }
  }
  return { code: code.join(""), noComments: noComments.join(""), strings };
}

export type TestCall = {
  kind: "test" | "group";
  name: string;
  marker: "" | "skip" | "only";
  // Hash input for the call's body (whitespace-normalised code view), so a renamed test can be recognised.
  body: string;
};

const MAX_NAME = 200;
const CALL_START = /(?:^|[^\w.$])(x|f)?(it|test|describe|context|suite)\b/g;
const SKIPPING = new Set(["skip", "todo", "skipIf", "runIf", "fails"]);
const WITH_ARGS = new Set(["each", "skipIf", "runIf", "for"]);

function skipSpace(code: string, i: number): number {
  let j = i;
  while (j < code.length && j - i < 2_000 && /\s/.test(code[j] ?? "")) j++;
  return j;
}

/**
 * For every opening bracket in the code view, the index just after its closing bracket (-1 when unclosed). One
 * linear pass, so hostile input (thousands of unclosed brackets) cannot make the parser quadratic.
 */
export function bracketPairs(code: string): Int32Array {
  const after = new Int32Array(code.length).fill(-1);
  const closer: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: number[] = [];
  for (let j = 0; j < code.length; j++) {
    const c = code[j] ?? "";
    if (closer[c]) stack.push(j);
    else if (c === ")" || c === "]" || c === "}") {
      // A closer that does not match the innermost opener is ignored (broken code stays linear too).
      const top = stack[stack.length - 1];
      if (top !== undefined && closer[code[top] ?? ""] === c) {
        stack.pop();
        after[top] = j + 1;
      }
    }
  }
  return after;
}

/** Every it/test/describe call with a literal name, with its skip/only marker and a body fingerprint. */
export function testCalls(src: Source, text: string): TestCall[] {
  const out: TestCall[] = [];
  const pairs = bracketPairs(src.code);
  const closeOf = (_code: string, open: number) => pairs[open] ?? -1;
  for (const m of src.code.matchAll(CALL_START)) {
    const prefix = m[1] ?? "";
    const word = m[2] ?? "";
    let i = (m.index ?? 0) + m[0].length;
    const modifiers: string[] = [];
    for (;;) {
      i = skipSpace(src.code, i);
      if (src.code[i] !== ".") break;
      const mod = /^\.\s*(\w+)/.exec(src.code.slice(i, i + 40));
      if (!mod) break;
      modifiers.push(mod[1] ?? "");
      i = skipSpace(src.code, i + (mod[0]?.length ?? 0));
      if (WITH_ARGS.has(mod[1] ?? "") && src.code[i] === "(") {
        const end = closeOf(src.code, i);
        if (end === -1) break;
        i = end;
      }
    }
    if (src.code[i] !== "(") continue;
    const callEnd = closeOf(src.code, i);
    const q = skipSpace(src.code, i + 1);
    const close = src.strings.get(q);
    if (close === undefined) continue;
    const name = text.slice(q + 1, close).slice(0, MAX_NAME);
    let marker: TestCall["marker"] =
      prefix === "x" || modifiers.some((md) => SKIPPING.has(md))
        ? "skip"
        : prefix === "f" || modifiers.includes("only")
          ? "only"
          : "";
    // Vitest options object: it("name", { skip: true }, fn)
    const afterName = skipSpace(src.code, close + 1);
    if (src.code[afterName] === ",") {
      const brace = skipSpace(src.code, afterName + 1);
      if (src.code[brace] === "{") {
        const end = closeOf(src.code, brace);
        const opts = src.code.slice(brace, end === -1 ? brace + 500 : end);
        if (/\b(skip|todo)\s*:\s*true\b/.test(opts)) marker = "skip";
        else if (/\bonly\s*:\s*true\b/.test(opts)) marker = "only";
      }
    }
    // Whitespace and trailing commas do not change a test (prettier rewraps code), so the fingerprint ignores them.
    const body =
      callEnd === -1
        ? ""
        : src.code
            .slice(close + 1, callEnd)
            .replace(/\s+/g, "")
            .replace(/,(?=[)\]}]|$)/g, "");
    out.push({
      kind: word === "it" || word === "test" ? "test" : "group",
      name,
      marker,
      body,
    });
  }
  return out;
}

/** expect / assert calls in code (not in comments or strings). */
export const assertionCount = (src: Source) =>
  (
    src.code.match(
      /\b(?:expect(?:\.(?:soft|poll|assertions|hasAssertions))?|assert(?:\.\w+)?)\s*\(/g,
    ) ?? []
  ).length;

/** Ways to skip or focus that carry no test name: a bare ctx.skip call, aliases of .only, it["only"]. */
export const namelessMarkers = (src: Source) =>
  (src.code.match(/\b\w+\.skip\s*\(\s*\)|=\s*(?:it|test|describe)\.(?:only|skip)\b/g) ?? [])
    .length + (src.noComments.match(/\[\s*["'`](?:only|skip)["'`]\s*\]/g) ?? []).length;
