import { z } from "zod";

export const methodSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid Python identifier"),
  signature: z.string().min(1),
});

export const stageConfigSchema = z.object({
  title: z.string().min(1),
  /** Overrides the problem-level class name for this stage. */
  class_name: z.string().optional(),
  /** Methods this stage adds. The stage's interface is these plus all earlier stages'. */
  methods: z.array(methodSchema).min(1),
});

export const problemConfigSchema = z.object({
  title: z.string().min(1),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  time_estimate_minutes: z.number().int().positive(),
  language: z.literal("python").default("python"),
  class_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  default_time_limit_ms: z.number().int().positive().default(2000),
  stages: z.array(stageConfigSchema).min(1),
});

export const testOpSchema = z
  .object({
    op: z.string().min(1),
    args: z.array(z.unknown()),
    expect: z.unknown(),
  })
  .strict()
  .refine((o) => "expect" in o, { message: "every operation needs an `expect` value" });

export const testCaseSchema = z
  .object({
    name: z.string().min(1),
    time_limit_ms: z.number().int().positive().optional(),
    ops: z.array(testOpSchema).min(1),
  })
  .strict();

export const testFileSchema = z.array(testCaseSchema).min(1);

export type ProblemConfig = z.infer<typeof problemConfigSchema>;
export type TestCaseFile = z.infer<typeof testCaseSchema>;
