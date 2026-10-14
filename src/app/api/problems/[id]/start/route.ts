import { z } from "zod";
import { enforceLimits, handle, parseBody, requireProblem, requireSession, sessionIdSchema } from "@/server/api";
import { RULES } from "@/server/ratelimit";
import { startProblem } from "@/server/service";

const bodySchema = z.object({ sessionId: sessionIdSchema });

/** Returns everything the session has unlocked for this problem, and nothing more. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { sessionId } = await parseBody(req, bodySchema);
  await enforceLimits(req, [[RULES.stateIp, "ip"]]);
  const problem = requireProblem(id);
  await requireSession(sessionId);
  return Response.json({ state: await startProblem(sessionId, problem) });
});
