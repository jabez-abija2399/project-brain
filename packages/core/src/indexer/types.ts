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
  /** Set for a React Router route: the file that declares it (App.tsx); `file` is the page component's file. */
  declaredIn?: string;
};

export type ImportIndex = {
  from: string;
  to: string;
  resolved: string | null;
  /** The specifier points outside the repo root; resolved is always null then. */
  outside: boolean;
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
  reason:
    | "too_large"
    | "binary"
    | "gitignored"
    | "projectbrainignored"
    | "excluded_dir"
    | "unsupported_ext"
    | "symlink";
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
