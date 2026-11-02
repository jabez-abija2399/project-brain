import release from "@/lib/cli-release.json";
import { type CliRelease, installPs1, scriptResponse } from "@/server/installers";

// D-027: `irm https://codeceipts.vercel.app/install.ps1 | iex` (Windows PowerShell). Public, no session.
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  return scriptResponse(installPs1(release as CliRelease));
}
