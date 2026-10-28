import { describe, expect, it } from "vitest";
import { maskSecret, maskSecretsIn } from "./mask";

// Fake secrets are built at runtime so no secret-shaped literal sits in the source (docs/build-checklist.md rule 3).
const FAKE_API_KEY = "abcd1234" + "zz";
const FAKE_DB_PASSWORD = "s3cret" + "pass";
const FAKE_RANDOM = "Q2hhbmdlTWUxMjM0NTY3ODkw" + "YWJjZGVmZ2hpams";

describe("@brain/core mask", () => {
  it("AC-005-14 maskSecret keeps the first 4 characters", () => {
    expect(maskSecret("abcdefgh")).toBe("abcd***");
  });

  it("AC-005-14 maskSecretsIn masks token formats, assigned secrets, URL passwords and long random strings", () => {
    const github = `ghp_${"a1B2".repeat(9)}`;
    expect(maskSecretsIn(`token ${github} leaked`)).toBe("token ghp_*** leaked");
    expect(maskSecretsIn(`relation "api_key=${FAKE_API_KEY}" does not exist`)).toBe(
      'relation "api_key=abcd***" does not exist',
    );
    expect(maskSecretsIn(`postgres://app:${FAKE_DB_PASSWORD}@db.example.com/x`)).toBe(
      "postgres://app:s3cr***@db.example.com/x",
    );
    expect(maskSecretsIn(`value ${FAKE_RANDOM}`)).toBe("value Q2hh***");
  });

  it("AC-005-14 maskSecretsIn leaves ordinary Postgres messages unchanged", () => {
    const msg = 'relation "public.profiles" does not exist';
    expect(maskSecretsIn(msg)).toBe(msg);
    expect(maskSecretsIn('syntax error at or near ";"')).toBe('syntax error at or near ";"');
  });
});
