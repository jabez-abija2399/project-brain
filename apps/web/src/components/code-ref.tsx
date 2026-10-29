// A file reference (path or path:line) in the mono font. The text is already cleaned and masked by the server.
export function CodeRef({ path, line }: { path: string; line?: number | null }) {
  return <code className="wrap">{line ? `${path}:${line}` : path}</code>;
}
