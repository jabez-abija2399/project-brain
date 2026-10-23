export type ColumnDecl = {
  name: string;
  type: string;
};

export type TableSchema = {
  name: string;
  file: string;
  columns: ColumnDecl[];
  rlsEnabled: boolean;
};

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export type PolicySchema = {
  name: string;
  table: string;
  file: string;
  command: PolicyCommand;
  roles: string[];
  using: string | null;
  withCheck: string | null;
};

export type SupabaseReadError = {
  file: string;
  message: string;
};

export type SupabaseReadResult = {
  root: string;
  tables: TableSchema[];
  policies: PolicySchema[];
  errors: SupabaseReadError[];
};
