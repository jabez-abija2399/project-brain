import { parseEars, planKindToCriterion } from "@brain/core";
import {
  type BlueprintTx,
  type PlannedFeatureCreated,
  blueprintRepo,
  criteriaRepo,
} from "@brain/db";
import { cleanBlueprintText, commitBlueprint } from "./blueprint";

// Roadmap Phase 3b: an approved plan becomes Blueprint version N+1 in the approval's own transaction. Each new
// checklist item becomes an active criterion linked to it (its plan kind decides behaviour, must-never or security),
// and the plan's depends_on names become dependencies. The owner approved exactly this draft (id + hash), so these
// are owner-approved criteria.

export async function commitPlanToBlueprint(
  tx: BlueprintTx,
  userId: string,
  pid: string,
  created: PlannedFeatureCreated[],
): Promise<void> {
  if (created.length === 0) return;
  const base = await blueprintRepo.currentVersion(tx, pid);
  await commitBlueprint(tx, userId, pid, base, "plan_approve", async (inner) => {
    const live = await blueprintRepo.live(inner, pid);
    const byName = new Map(live.features.map((f) => [f.name.toLowerCase(), f.id]));
    for (const f of created) {
      const deps = [
        ...new Set(
          f.dependsOn
            .map((n) => byName.get(n.toLowerCase()))
            .filter((id): id is string => id !== undefined && id !== f.featureId),
        ),
      ];
      if (deps.length > 0) await blueprintRepo.setDependencies(inner, pid, f.featureId, deps);
      for (const [position, item] of f.items.entries()) {
        const text = cleanBlueprintText(item.text);
        if (!text) continue;
        await criteriaRepo.insert(inner, pid, {
          featureId: f.featureId,
          text,
          ears: parseEars(text),
          kind: planKindToCriterion(item.kind),
          createdBy: "owner",
          status: "active",
          checklistItemId: item.id,
          position,
        });
      }
    }
  });
}
