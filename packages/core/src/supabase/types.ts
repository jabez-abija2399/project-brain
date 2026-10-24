export type ColumnDecl = {
  name: string;
  type: string;
};

export type TableSchema = {
  schema: string;
  name: string;
  file: string;
  columns: ColumnDecl[];
  // true only when the migrations clearly enable RLS; false when disabled or unknown.
  rlsEnabled: boolean;
  // A statement touching the table could not be read (or ran dynamic SQL), so its RLS state is not known.
  rlsUnknown: boolean;
};

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export type PolicySchema = {
  name: string;
  schema: string;
  table: string;
  file: string;
  command: PolicyCommand;
  roles: string[];
  // AS PERMISSIVE (default) or AS RESTRICTIVE; a restrictive policy only narrows access, it never grants it.
  permissive: boolean;
  using: string | null;
  withCheck: string | null;
};

export type SupabaseReadError = {
  file: string;
  // 1-based line where the failing statement starts; absent when the whole directory could not be read.
  line?: number;
  message: string;
};

export type SupabaseReadResult = {
  root: string;
  tables: TableSchema[];
  policies: PolicySchema[];
  errors: SupabaseReadError[];
};
