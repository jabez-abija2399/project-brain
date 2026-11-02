// Runs the stdio sandbox child under Node (the tests of the native binary's protocol, stdio-mode.test.ts).
import { serveStdioJob } from "./stdio-child.mjs";

await serveStdioJob();
