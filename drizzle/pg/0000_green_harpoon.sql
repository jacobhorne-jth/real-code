CREATE TABLE "attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"problem_id" text NOT NULL,
	"started_at" bigint NOT NULL,
	"finished_at" bigint
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"problem_id" text,
	"type" text NOT NULL,
	"stage" integer,
	"data" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"problem_id" text NOT NULL,
	"feedback" text,
	"email" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"problem_id" text NOT NULL,
	"stage" integer NOT NULL,
	"passed" boolean NOT NULL,
	"regression_count" integer NOT NULL,
	"report" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attempts_problem_idx" ON "attempts" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","problem_id");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "submissions_session_problem_idx" ON "submissions" USING btree ("session_id","problem_id");