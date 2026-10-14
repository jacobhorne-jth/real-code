import { z } from "zod";
import {
  codeSchema,
  enforceLimits,
  handle,
  parseBody,
  requireProblem,
  requireSession,
  sessionIdSchema,
} from "@/server/api";
import { RULES } from "@/server/ratelimit";
import { runCode } from "@/server/service";

// The stage is decided by the server from the session's submit history.
const bodySchema = z.object({ sessionId: sessionIdSchema, code: codeSchema });

export const maxDuration = 60;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { sessionId, code } = await parseBody(req, bodySchema);
  const problem = requireProblem(id);
  await enforceLimits(req, [
    [RULES.runSession, sessionId],
    [RULES.runIp, "ip"],
  ]);
  await requireSession(sessionId);
  return Response.json({ report: await runCode(sessionId, problem, code) });
});
