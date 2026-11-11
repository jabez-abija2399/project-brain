import { createHash } from "node:crypto";
import { type BrainDb, githubRepo } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readCapped } from "./body";
import { githubConfig, verifySignature } from "./github";
import { PR_EVENT, PUSH_EVENT, getEventSender, getPrEventSender } from "./inngest";
import { prReceiptsOn } from "./project-settings";

// GitHub caps webhook payloads at 25 MB; a push payload is far smaller, so anything above this is refused unread.
export const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const repoName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const pushSchema = z.object({
  ref: z.string().max(300),
  before: sha,
  after: sha,
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: repoName, default_branch: z.string().min(1).max(255) }),
  installation: z.object({ id: z.number().int().positive() }),
});
// Roadmap Phase 10b: a pull request opened or updated. The head repository tells a fork apart from the repo itself.
const PR_ACTIONS = new Set(["opened", "reopened", "synchronize"]);
const pullRequestSchema = z.object({
  action: z.string().max(50),
  number: z.number().int().positive(),
  pull_request: z.object({
    head: z.object({ sha, repo: z.object({ full_name: repoName }).nullable() }),
  }),
  repository: z.object({ full_name: repoName, private: z.boolean().optional() }),
  installation: z.object({ id: z.number().int().positive() }),
});
const installationSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
});
const installationReposSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repositories_removed: z
    .array(z.object({ full_name: repoName }))
    .max(1000)
    .optional(),
});

const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status });

/**
 * POST /api/github/webhook (docs/specs/FEAT-009.md section 7). The signature is checked on the raw bytes before
 * anything is parsed; a delivery id is processed at most once; a push to the default branch of a linked repo
 * enqueues one Inngest event per project (202). No GitHub API call happens here, so it answers well within 2 s.
 */
export async function handleWebhook(
  db: BrainDb,
  req: Request,
  now = new Date(),
): Promise<Response> {
  const config = githubConfig();
  if (!config) return json({ error: "github_not_configured" }, 503);
  const raw = await readCapped(req, MAX_WEBHOOK_BYTES);
  if (raw === null) return json({ error: "payload_too_large" }, 413);
  const signed = await verifySignature(
    config.webhookSecret,
    raw,
    req.headers.get("x-hub-signature-256"),
  );
  if (!signed) return json({ error: "bad_signature" }, 401);

  const event = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";
  if (event === "ping") return json({ ok: true }, 200);
  if (
    event !== "push" &&
    event !== "installation" &&
    event !== "installation_repositories" &&
    event !== "pull_request"
  ) {
    return json({ error: "unsupported_event" }, 400);
  }
  if (!/^[A-Za-z0-9-]{1,100}$/.test(deliveryId)) return json({ error: "bad_delivery_id" }, 400);
  // The delivery id header is not covered by the signature, so the signed body counts too: a captured body sent
  // again under a new id is a duplicate. GitHub's own redelivery keeps the id, so it is a duplicate either way.
  const bodyKey = `sha256-${createHash("sha256").update(raw).digest("hex")}`;
  const newId = await githubRepo.recordDelivery(db, deliveryId, now);
  const newBody = await githubRepo.recordDelivery(db, bodyKey, now);
  if (!newId || !newBody) return json({ ok: true, duplicate: true }, 200);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_payload" }, 400);
  }

  if (event === "installation") {
    const parsed = installationSchema.safeParse(body);
    if (!parsed.success) return json({ error: "bad_payload" }, 400);
    // Uninstalled or suspended: the App lost access, so linked projects stop receiving pushes (their jobs would only
    // fail on the installation token). After an unsuspend the owner links the repository again.
    if (parsed.data.action === "deleted" || parsed.data.action === "suspend") {
      await githubRepo.unlinkInstallation(db, parsed.data.installation.id);
    }
    return json({ ok: true }, 200);
  }

  if (event === "installation_repositories") {
    const parsed = installationReposSchema.safeParse(body);
    if (!parsed.success) return json({ error: "bad_payload" }, 400);
    // Repositories taken out of the installation: projects linked to them are unlinked.
    if (parsed.data.action === "removed") {
      await githubRepo.unlinkRepos(
        db,
        parsed.data.installation.id,
        (parsed.data.repositories_removed ?? []).map((r) => r.full_name),
      );
    }
    return json({ ok: true }, 200);
  }

  if (event === "pull_request") {
    const parsed = pullRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: "bad_payload" }, 400);
    const pr = parsed.data;
    // Never for a fork's pull request (its commits and receipts are not this project's), and only when a pull
    // request is opened or gets new commits.
    const fromFork = pr.pull_request.head.repo?.full_name !== pr.repository.full_name;
    if (fromFork || !PR_ACTIONS.has(pr.action)) return json({ ok: true, enqueued: false }, 200);
    try {
      const linked = await githubRepo.linkedProjects(
        db,
        pr.installation.id,
        pr.repository.full_name,
      );
      // Off by default: only projects whose owner turned PR receipts on.
      const on: { id: string }[] = [];
      for (const p of linked) if (await prReceiptsOn(db, p.id)) on.push(p);
      if (on.length === 0) return json({ ok: true, enqueued: false }, 200);
      await getPrEventSender()(
        on.map((p) => ({
          name: PR_EVENT,
          data: {
            projectId: p.id,
            installationId: pr.installation.id,
            repo: pr.repository.full_name,
            number: pr.number,
            headSha: pr.pull_request.head.sha,
            // Fail closed: counts only unless GitHub says the repository is private (the job reads it again).
            publicRepo: pr.repository.private !== true,
            deliveryId,
          },
        })),
      );
    } catch {
      // Not enqueued (a database or queue error): forget the delivery so GitHub's redelivery is processed.
      await githubRepo.forgetDelivery(db, deliveryId);
      await githubRepo.forgetDelivery(db, bodyKey);
      return json({ error: "enqueue_failed" }, 503);
    }
    return json({ ok: true, enqueued: true }, 202);
  }

  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_payload" }, 400);
  const push = parsed.data;
  if (push.deleted || push.ref !== `refs/heads/${push.repository.default_branch}`) {
    return json({ ok: true, enqueued: false }, 200);
  }
  const projects = await githubRepo.linkedProjects(
    db,
    push.installation.id,
    push.repository.full_name,
  );
  if (projects.length === 0) return json({ ok: true, enqueued: false }, 200);
  try {
    await getEventSender()(
      projects.map((p) => ({
        name: PUSH_EVENT,
        data: {
          projectId: p.id,
          installationId: push.installation.id,
          repo: push.repository.full_name,
          before: push.before,
          after: push.after,
          deliveryId,
        },
      })),
    );
  } catch {
    // Not enqueued: forget the id so GitHub's redelivery of this push is processed.
    await githubRepo.forgetDelivery(db, deliveryId);
    await githubRepo.forgetDelivery(db, bodyKey);
    return json({ error: "enqueue_failed" }, 503);
  }
  return json({ ok: true, enqueued: true }, 202);
}
