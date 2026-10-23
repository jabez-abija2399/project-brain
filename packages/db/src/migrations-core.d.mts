export type SqlExec = {
  exec: (sql: string) => Promise<void>;
  query: <T = unknown>(sql: string) => Promise<T[]>;
  transaction: <R>(fn: (tx: SqlExec) => Promise<R>) => Promise<R>;
};

export function runMigrations(driver: SqlExec): Promise<{ applied: string[] }>;
