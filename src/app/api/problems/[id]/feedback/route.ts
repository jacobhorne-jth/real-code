import { z } from "zod";
import {
  enforceLimits,
  fail,
  handle,
  parseBody,
  requireProblem,
  requireSession,
  sessionIdSchema,
} from "@/server/api";
import { RULES } from "@/server/ratelimit";
import { NotFinishedError, submitFeedback } from "@/server/service";

const bodySchema = z.object({
  sessionId: sessionIdSchema,
  feedback: z.string().trim().max(5000).optional().default(""),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .default("")
    .refine((e) => e === "" || z.email().safeParse(e).success, { message: "Enter a valid email address" }),
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  const problem = requireProblem(id);
  await enforceLimits(req, [
    [RULES.feedbackSession, body.sessionId],
    [RULES.feedbackIp, "ip"],
  ]);
  await requireSession(body.sessionId);
  if (!body.feedback && !body.email) fail(400, "bad_request", "Nothing to submit");
  try {
    await submitFeedback(body.sessionId, problem, {
      feedback: body.feedback || null,
      email: body.email || null,
    });
  } catch (err) {
    if (err instanceof NotFinishedError) fail(403, "not_finished", err.message);
    throw err;
  }
  return Response.json({ ok: true });
});
