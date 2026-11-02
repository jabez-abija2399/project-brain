import release from "@/lib/cli-release.json";
import { type CliRelease, installSh, scriptResponse } from "@/server/installers";

// D-027: `curl -fsSL https://codeceipts.vercel.app/install.sh | sh` (macOS, Linux, WSL). Public, no session.
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  return scriptResponse(installSh(release as CliRelease));
}
