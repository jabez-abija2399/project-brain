import { describe, expect, it } from "vitest";
import { maskSecret, maskSecretsIn } from "./mask";

describe("@brain/core mask", () => {
  it("AC-005-14 maskSecret keeps the first 4 characters", () => {
    expect(maskSecret("abcdefgh")).toBe("abcd***");
  });

  it("AC-005-14 maskSecretsIn masks token formats, assigned secrets, URL passwords and long random strings", () => {
    const github = `ghp_${"a1B2".repeat(9)}`;
    expect(maskSecretsIn(`token ${github} leaked`)).toBe("token ghp_*** leaked");
    expect(maskSecretsIn('relation "api_key=abcd1234zz" does not exist')).toBe(
      'relation "api_key=abcd***" does not exist',
    );
    expect(maskSecretsIn("postgres://app:s3cretpass@db.example.com/x")).toBe(
      "postgres://app:s3cr***@db.example.com/x",
    );
    const random = "Q2hhbmdlTWUxMjM0NTY3ODkwYWJjZGVmZ2hpams";
    expect(maskSecretsIn(`value ${random}`)).toBe("value Q2hh***");
  });

  it("AC-005-14 maskSecretsIn leaves ordinary Postgres messages unchanged", () => {
    const msg = 'relation "public.profiles" does not exist';
    expect(maskSecretsIn(msg)).toBe(msg);
    expect(maskSecretsIn('syntax error at or near ";"')).toBe('syntax error at or near ";"');
  });
});
