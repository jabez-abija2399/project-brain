export type ComponentIndex = {
  name: string;
  path: string;
  line: number;
  props: string | null;
  signature: string;
};

export type RouteIndex = {
  path: string;
  file: string;
  line: number;
  method: "page" | "route";
};

export type ImportIndex = {
  from: string;
  to: string;
  resolved: string | null;
  line: number;
  external: boolean;
};

export type FileIndex = {
  path: string;
  hash: string;
  imports: ImportIndex[];
};

export type SkippedFile = {
  path: string;
  reason: "too_large" | "binary" | "gitignored" | "excluded_dir" | "unsupported_ext" | "symlink";
};

export type IndexError = {
  path: string;
  line: number;
  message: string;
};

export type IndexResult = {
  root: string;
  files: FileIndex[];
  components: ComponentIndex[];
  routes: RouteIndex[];
  skipped: SkippedFile[];
  errors: IndexError[];
};

export type IndexOptions = {
  maxFileBytes?: number;
};
