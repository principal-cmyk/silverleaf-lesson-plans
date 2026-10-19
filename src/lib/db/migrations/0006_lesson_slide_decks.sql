CREATE TABLE "lesson_slide_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"deck" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"generated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_slide_decks_plan_id_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
ALTER TABLE "lesson_slide_decks" ADD CONSTRAINT "lesson_slide_decks_plan_id_lesson_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."lesson_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_slide_decks" ADD CONSTRAINT "lesson_slide_decks_generated_by_staff_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;