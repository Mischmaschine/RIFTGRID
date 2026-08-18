ALTER TABLE "deployment_templates" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;

CREATE TABLE "deployment_template_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "installer_id" text NOT NULL,
  "installer_version" text NOT NULL,
  "configuration" jsonb NOT NULL,
  "cpu_millicores" integer NOT NULL,
  "memory_mib" integer NOT NULL,
  "storage_gib" integer NOT NULL,
  "placement" jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "deployment_template_revisions" ADD CONSTRAINT "deployment_template_revisions_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."deployment_templates"("id") ON DELETE cascade;
ALTER TABLE "deployment_template_revisions" ADD CONSTRAINT "deployment_template_revisions_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE UNIQUE INDEX "deployment_template_revisions_template_revision_uq" ON "deployment_template_revisions" USING btree ("template_id", "revision");
CREATE INDEX "deployment_template_revisions_template_idx" ON "deployment_template_revisions" USING btree ("template_id", "created_at");

INSERT INTO "deployment_template_revisions" ("template_id", "revision", "name", "description", "installer_id", "installer_version", "configuration", "cpu_millicores", "memory_mib", "storage_gib", "placement", "created_by", "created_at")
SELECT "id", 1, "name", "description", "installer_id", "installer_version", "configuration", "cpu_millicores", "memory_mib", "storage_gib", "placement", "created_by", "updated_at"
FROM "deployment_templates";
