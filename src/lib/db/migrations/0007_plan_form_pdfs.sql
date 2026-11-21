CREATE TABLE "plan_form_pdfs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_form_pdfs_plan_id_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
ALTER TABLE "plan_form_pdfs" ADD CONSTRAINT "plan_form_pdfs_plan_id_lesson_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."lesson_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_form_pdfs" ADD CONSTRAINT "plan_form_pdfs_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;