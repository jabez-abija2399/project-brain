import { type AddressInfo, createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { type SqlExec, runMigrations } from "./migrations";

function toDriver(db: PGlite): SqlExec {
  return {
    exec: async (sql: string) => {
      await db.exec(sql);
    },
    query: async <T = unknown>(sql: string, params?: unknown[]) => {
      const result = await db.query<T>(sql, params as unknown[] | undefined);
      return result.rows;
    },
  };
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  await runMigrations(toDriver(db));
  return db;
}

export function pgliteDriver(db: PGlite): SqlExec {
  return toDriver(db);
}

// Serves a PGlite instance on a 127.0.0.1 TCP port so code that takes a DATABASE_URL
// (and its own postgres.js client) can run against a real Postgres in tests.
// PGlite 0.2 can't parse the startup packet, so the handshake is answered here
// (trust auth); every later message goes to PGlite unchanged.
const AUTH_OK_READY = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]);

export async function servePgliteOverTcp(
  db: PGlite,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let started = false;
    let pending: Buffer[] = [];
    let chain = Promise.resolve();
    socket.on("error", () => {});
    socket.on("data", (data) => {
      buf = Buffer.concat([buf, data]);
      for (;;) {
        // Startup packet: int32 length. Afterwards: 1-byte type + int32 length.
        const headerLen = started ? 5 : 4;
        if (buf.length < headerLen) return;
        const msgLen = started ? buf.readInt32BE(1) + 1 : buf.readInt32BE(0);
        if (buf.length < msgLen) return;
        const msg = buf.subarray(0, msgLen);
        buf = buf.subarray(msgLen);
        if (!started) {
          started = true;
          socket.write(AUTH_OK_READY);
          continue;
        }
        if (msg[0] === 0x58) {
          // 'X' Terminate
          chain = chain.then(() => {
            socket.end();
          });
          continue;
        }
        // PGlite replies to an extended-protocol batch only when it gets the whole
        // batch at once, so queue messages until Sync ('S') or a simple Query ('Q').
        pending.push(msg);
        if (msg[0] !== 0x53 && msg[0] !== 0x51) continue;
        const batch = Buffer.concat(pending);
        pending = [];
        chain = chain.then(async () => {
          const reply = await db.execProtocolRaw(new Uint8Array(batch));
          if (reply.length && socket.writable) socket.write(reply);
        });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
