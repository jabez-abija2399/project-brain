import { CliError, EXIT } from "./api";

type TtyInput = NodeJS.ReadableStream & { setRawMode(mode: boolean): unknown };

// L1: reads one line from a terminal in raw mode, so the typed or pasted token is never echoed (nor kept in
// scrollback). Backspace edits, Enter (or Ctrl-D) ends the line, Ctrl-C cancels; the terminal mode is always restored.
export function readHiddenLine(input: TtyInput, write: (s: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let line = "";
    const finish = (err?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      write("\n");
      if (err) reject(err);
      else resolve(line);
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") return finish(new CliError(EXIT.failure, "Login cancelled."));
        if (ch === "\u007f" || ch === "\b") line = line.slice(0, -1);
        else line += ch;
      }
    };
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
  });
}
