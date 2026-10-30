import { AppError } from "./errors";

// Reads at most `limit` bytes; null when the body is larger (it is never parsed then). Counts the bytes actually
// read, so a body sent without Content-Length (chunked) is capped too.
export async function readCapped(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON body, at most `limit` bytes (413 when larger); null when it is empty or not JSON. */
export async function readJsonCapped(req: Request, limit: number): Promise<unknown> {
  const text = await readCapped(req, limit);
  if (text === null) throw new AppError(413, "payload_too_large", "request body too large");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
