CREATE TABLE "node_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "created_by" uuid,
  "node_name" text NOT NULL,
  "operating_system" text NOT NULL,
  "architecture" text NOT NULL,
  "riftgrid_url" text NOT NULL,
  "kubernetes_server_url" text NOT NULL,
  "token_hash" text NOT NULL,
  "status" text DEFAULT 'WAITING' NOT NULL,
  "current_step" text DEFAULT 'Waiting for the remote server' NOT NULL,
  "last_message" text,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "node_enrollments" ADD CONSTRAINT "node_enrollments_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
ALTER TABLE "node_enrollments" ADD CONSTRAINT "node_enrollments_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE UNIQUE INDEX "node_enrollments_token_hash_uq" ON "node_enrollments" USING btree ("token_hash");
CREATE INDEX "node_enrollments_org_created_idx" ON "node_enrollments" USING btree ("organization_id", "created_at");
CREATE INDEX "node_enrollments_node_idx" ON "node_enrollments" USING btree ("node_name");
