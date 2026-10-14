import { enforceLimits, handle } from "@/server/api";
import { createSession } from "@/server/db/store";
import { RULES } from "@/server/ratelimit";

/** Create an anonymous session. The browser keeps the id in localStorage. */
export const POST = handle(async (req: Request) => {
  await enforceLimits(req, [[RULES.sessionCreateIp, "ip"]]);
  const sessionId = await createSession();
  return Response.json({ sessionId });
});
