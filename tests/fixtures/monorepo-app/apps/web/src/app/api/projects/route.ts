import { requireProjectAccess } from "../../../server/auth";
import { listProjects } from "../../../server/projects";

export async function GET(req: Request) {
  await requireProjectAccess(req);
  return Response.json(await listProjects());
}
