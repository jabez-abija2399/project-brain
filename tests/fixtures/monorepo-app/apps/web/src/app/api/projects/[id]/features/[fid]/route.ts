import { requireProjectAccess } from "../../../../../../server/auth";
import { getFeature } from "../../../../../../server/features";

export async function GET(req: Request) {
  await requireProjectAccess(req);
  return Response.json(await getFeature());
}
