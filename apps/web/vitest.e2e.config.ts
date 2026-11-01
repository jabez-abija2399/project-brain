import base from "./vitest.config";

// End-to-end checks against the production build (`next build` + `next start`). Same settings as the unit suite,
// but only e2e files, with long timeouts: they need a disposable Postgres database in E2E_DATABASE_URL and take minutes.
export default {
  ...base,
  test: {
    ...base.test,
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
  },
};
