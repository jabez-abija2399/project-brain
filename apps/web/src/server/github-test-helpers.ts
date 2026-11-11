// Test-only: a GitHub App made at runtime (fresh RSA key and webhook secret, no real secrets) and a fetch stub that
// plays the GitHub API, so the real Octokit code paths run without a network.
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { vi } from "vitest";
import { type GithubConfig, setGithubConfigForTests } from "./github";

export function makeGithubConfig(): GithubConfig {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const config: GithubConfig = {
    appId: "12345",
    privateKey,
    webhookSecret: randomBytes(32).toString("hex"),
    slug: "project-brain-test",
    clientId: ["Iv1", randomBytes(8).toString("hex")].join("."),
    clientSecret: randomBytes(20).toString("hex"),
  };
  setGithubConfigForTests(config);
  return config;
}

export function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// A token-shaped value built at runtime (never a literal in the source).
const fakeToken = (prefix: string) => [prefix, "_", "x".repeat(36)].join("");

export type FakeRepo = {
  // installation id -> repos it can see
  installations: Record<number, string[]>;
  // installations the OAuth user can access
  userInstallations: number[];
  // repositories the OAuth user can access in each installation (default: all of the installation's)
  userRepos?: Record<number, string[]>;
  // the OAuth user's access per repository (default: push), and a total larger than the list (more pages)
  userAccess?: Record<string, "read" | "push" | "admin">;
  userReposTotal?: number;
  // the GitHub user behind the OAuth code (default 1001: the owner in the install tests)
  githubUserId?: number;
  installationReposTotal?: number;
  // compare result per "before...after"
  compare: Record<string, { filename: string; status: string; previous_filename?: string }[]>;
  // file contents at the push's commit
  files: Record<string, string | Buffer>;
  // FEAT-023: file contents at other commits (by sha), and the commit messages a compare returns
  filesAt?: Record<string, Record<string, string | Buffer>>;
  commitMessages?: Record<string, string[]>;
};

export type GithubMock = {
  repo: FakeRepo;
  fetchedPaths: string[];
  requests: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Stubs global fetch with a small GitHub API. Unknown URLs fail the test loudly (404 with the URL).
export function mockGithub(repo: FakeRepo): GithubMock {
  const mock: GithubMock = { repo, fetchedPaths: [], requests: [] };
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    mock.requests.push(`${method} ${url.pathname}`);
    if (
      method === "POST" &&
      url.hostname === "github.com" &&
      url.pathname === "/login/oauth/access_token"
    ) {
      return json({ access_token: fakeToken("ghu"), token_type: "bearer", scope: "" });
    }
    if (url.hostname !== "api.github.com") return json({ message: `unexpected ${url}` }, 404);
    if (method === "DELETE" && /^\/applications\/[^/]+\/token$/.test(url.pathname)) {
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.pathname === "/user") {
      return json({ id: repo.githubUserId ?? 1001, login: "someone" });
    }
    let m = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (method === "POST" && m) {
      if (!repo.installations[Number(m[1])]) return json({ message: "Not Found" }, 404);
      return json(
        { token: fakeToken("ghs"), expires_at: "2099-01-01T00:00:00Z", permissions: {} },
        201,
      );
    }
    m = url.pathname.match(/^\/user\/installations\/(\d+)\/repositories$/);
    if (m) {
      const id = Number(m[1]);
      if (!repo.userInstallations.includes(id)) return json({ message: "Not Found" }, 404);
      const mine = repo.userRepos?.[id] ?? repo.installations[id] ?? [];
      const access = (name: string) => repo.userAccess?.[name] ?? "push";
      return json({
        total_count: repo.userReposTotal ?? mine.length,
        repositories: mine.map((full_name) => ({
          full_name,
          permissions: {
            admin: access(full_name) === "admin",
            push: access(full_name) === "admin" || access(full_name) === "push",
            pull: true,
          },
        })),
      });
    }
    if (url.pathname === "/user/installations") {
      return json({
        total_count: repo.userInstallations.length,
        installations: repo.userInstallations.map((id) => ({ id })),
      });
    }
    if (url.pathname === "/installation/repositories") {
      const all = Object.values(repo.installations)[0] ?? [];
      return json({
        total_count: repo.installationReposTotal ?? all.length,
        repositories: all.map((full_name) => ({ full_name })),
      });
    }
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/compare\/(.+)$/);
    if (m) {
      const files = repo.compare[decodeURIComponent(m[1] as string)] ?? [];
      const page = Number(url.searchParams.get("page") ?? "1");
      const per = Number(url.searchParams.get("per_page") ?? "100");
      const messages = repo.commitMessages?.[decodeURIComponent(m[1] as string)] ?? [];
      return json({
        files: files.slice((page - 1) * per, page * per),
        commits: messages.map((message) => ({ commit: { message } })),
      });
    }
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[1] as string);
      mock.fetchedPaths.push(path);
      const ref = url.searchParams.get("ref") ?? "";
      const content = repo.filesAt?.[ref] ? repo.filesAt[ref]?.[path] : repo.files[path];
      if (content === undefined) return json({ message: "Not Found" }, 404);
      const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
      return json({
        type: "file",
        encoding: "base64",
        size: bytes.length,
        content: bytes.toString("base64"),
      });
    }
    return json({ message: `unexpected ${method} ${url.pathname}` }, 404);
  });
  return mock;
}

export function restoreGithub(): void {
  vi.unstubAllGlobals();
  setGithubConfigForTests(undefined);
}

/**
 * A tiny cookie jar for route tests: `remember` keeps the cookies a response sets, `attach` sends them on the next
 * request (as a browser would for the same path).
 */
export function cookieJar() {
  const jar = new Map<string, string>();
  return {
    remember(res: Response): Response {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const eq = (pair ?? "").indexOf("=");
        if (eq > 0) jar.set((pair as string).slice(0, eq).trim(), (pair as string).slice(eq + 1));
      }
      return res;
    },
    attach(req: Request): Request {
      if (jar.size === 0) return req;
      const headers = new Headers(req.headers);
      headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      return new Request(req, { headers });
    },
    clear: () => jar.clear(),
  };
}
