// FEAT-015: security findings for a receipt: secrets (found and masked by the CLI) and RLS problems (from the stored
// flags of the last index). Every text an agent reads goes through oneLineText and mask.
import { maskSecretsIn } from "./mask";
import type { SecretType } from "./secrets";
import { oneLineText } from "./text";

export type FindingType =
  | SecretType
  | "rls_disabled"
  | "rls_cannot_be_confirmed"
  | "policy_allows_everyone_to_write";
export type Finding = {
  type: FindingType;
  file: string;
  // null when the source line is not known (RLS findings come from the whole migration history).
  line: number | null;
  masked_value?: string;
  table?: string;
  hint: string;
};

const safe = (value: string) => maskSecretsIn(oneLineText(value));
// Paths are masked per segment, so an ordinary long file name is not taken for a secret.
const safePath = (path: string) => oneLineText(path).split("/").map(maskSecretsIn).join("/");

const ROTATE =
  "Rotate it now, then load it from a server-only environment variable; never commit it.";
const SECRET_HINTS: Record<SecretType, string> = {
  supabase_service_role_key: `Supabase service-role key: it bypasses RLS. ${ROTATE}`,
  supabase_secret_key: `Supabase secret key: it bypasses RLS. ${ROTATE}`,
  stripe_secret_key: `Stripe live secret key. ${ROTATE}`,
  anthropic_api_key: `Anthropic API key. ${ROTATE}`,
  openai_api_key: `OpenAI API key. ${ROTATE}`,
  github_token: `GitHub token. ${ROTATE}`,
  aws_access_key: `AWS access key. ${ROTATE}`,
  private_key: `Private key. ${ROTATE}`,
};

export function secretFinding(f: {
  file: string;
  line: number;
  type: SecretType;
  masked_value: string;
}): Finding {
  return {
    type: f.type,
    file: safePath(f.file),
    line: f.line,
    masked_value: f.masked_value,
    hint: SECRET_HINTS[f.type],
  };
}

export type StoredTable = {
  schema: string;
  name: string;
  path: string;
  rlsEnabled: boolean;
  rlsUnknown: boolean;
  policies: { command: string; permissive: boolean; allowsAll: boolean }[];
};

const WRITE_COMMANDS = new Set(["INSERT", "UPDATE", "DELETE", "ALL"]);

/**
 * RLS findings for every stored table (AC-015-04): RLS off, RLS that cannot be confirmed (AC-015-06: never safe,
 * never skipped), and permissive policies that let anyone write. A restrictive policy never counts as allowing
 * everyone (AC-015-07), whatever its flags say.
 */
export function rlsFindings(tables: StoredTable[]): Finding[] {
  const out: Finding[] = [];
  for (const t of tables) {
    const table = safe(`${t.schema}.${t.name}`);
    const file = safePath(t.path);
    if (t.rlsUnknown) {
      out.push({
        type: "rls_cannot_be_confirmed",
        file,
        line: null,
        table,
        hint: "RLS cannot be confirmed: a migration touching this table could not be read. Check it in the Supabase dashboard, then run `projectbrain index` again.",
      });
    } else if (!t.rlsEnabled) {
      out.push({
        type: "rls_disabled",
        file,
        line: null,
        table,
        hint: `RLS is off: anyone with the anon key can read and change every row. Add ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY and policies.`,
      });
    } else {
      const open = [
        ...new Set(
          t.policies
            .filter((p) => p.permissive && p.allowsAll && WRITE_COMMANDS.has(p.command))
            .map((p) => p.command),
        ),
      ];
      if (open.length > 0) {
        out.push({
          type: "policy_allows_everyone_to_write",
          file,
          line: null,
          table,
          hint: `A policy lets everyone ${open.join("/")} (USING or WITH CHECK is true): restrict it, e.g. to auth.uid() = owner.`,
        });
      }
    }
  }
  return out;
}
