import { tools } from "@/server/tools";
import { requireProjectAccess } from "../../server/auth";

export async function POST(req: Request) {
  await requireProjectAccess(req);
  return Response.json({ tools });
}
