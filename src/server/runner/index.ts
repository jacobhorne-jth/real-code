import { LocalRunner } from "./local";
import { ModalRunner } from "./modal";
import { CodeExecutionUnavailableError, type CodeRunner } from "./types";

export * from "./types";
export { LocalRunner } from "./local";
export { ModalRunner } from "./modal";

type Env = Record<string, string | undefined>;

export function isModalConfigured(env: Env = process.env): boolean {
  return Boolean(env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET);
}

/**
 * Choose the code runner from the environment. LocalRunner is not a security
 * boundary, so production refuses to fall back to it.
 */
export function createRunner(env: Env = process.env): CodeRunner {
  if (isModalConfigured(env)) {
    return new ModalRunner({
      tokenId: env.MODAL_TOKEN_ID!,
      tokenSecret: env.MODAL_TOKEN_SECRET!,
      appName: env.MODAL_APP_NAME || undefined,
      functionName: env.MODAL_FUNCTION_NAME || undefined,
      environment: env.MODAL_ENVIRONMENT || undefined,
    });
  }
  if (env.NODE_ENV === "production") {
    throw new CodeExecutionUnavailableError(
      "Code execution is not configured. Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET; " +
        "the local runner is disabled in production because it is not a secure sandbox.",
    );
  }
  return new LocalRunner();
}

let cached: CodeRunner | null = null;

export function getRunner(): CodeRunner {
  cached ??= createRunner();
  return cached;
}
