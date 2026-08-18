CREATE TABLE "stack_blueprints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "ecosystem" text DEFAULT 'GENERIC' NOT NULL,
  "status" text DEFAULT 'PREVIEW' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "stacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "blueprint_id" uuid,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "desired_state" text DEFAULT 'RUNNING' NOT NULL,
  "created_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "stack_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stack_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "component_type" text DEFAULT 'WORKLOAD' NOT NULL,
  "resource_kind" text NOT NULL,
  "server_id" uuid,
  "managed_database_id" uuid,
  "workload_semantics" text DEFAULT 'PERSISTENT' NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "component_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stack_id" uuid NOT NULL,
  "source_component_id" uuid NOT NULL,
  "target_component_id" uuid NOT NULL,
  "type" text NOT NULL,
  "required_for_startup" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "service_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stack_id" uuid NOT NULL,
  "consumer_component_id" uuid NOT NULL,
  "provider_component_id" uuid NOT NULL,
  "logical_name" text NOT NULL,
  "port_name" text,
  "environment_variable" text,
  "protocol" text DEFAULT 'TCP' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "scaling_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "component_id" uuid NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "min_instances" integer DEFAULT 1 NOT NULL,
  "max_instances" integer DEFAULT 1 NOT NULL,
  "metric" text DEFAULT 'MANUAL' NOT NULL,
  "scale_up_threshold" integer,
  "scale_down_empty_seconds" integer,
  "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "scaling_policies_component_id_unique" UNIQUE("component_id")
);
CREATE TABLE "placement_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stack_id" uuid NOT NULL,
  "component_id" uuid,
  "name" text NOT NULL,
  "policy" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "stack_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stack_id" uuid NOT NULL,
  "requested_by" uuid,
  "action" text NOT NULL,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "plan" jsonb NOT NULL,
  "cursor" integer DEFAULT 0 NOT NULL,
  "current_component_id" uuid,
  "current_task_id" uuid,
  "current_step" text,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "finished_at" timestamptz
);

ALTER TABLE "stack_blueprints" ADD CONSTRAINT "stack_blueprints_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
ALTER TABLE "stack_blueprints" ADD CONSTRAINT "stack_blueprints_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
ALTER TABLE "stacks" ADD CONSTRAINT "stacks_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
ALTER TABLE "stacks" ADD CONSTRAINT "stacks_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."stack_blueprints"("id") ON DELETE set null;
ALTER TABLE "stacks" ADD CONSTRAINT "stacks_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
ALTER TABLE "stack_components" ADD CONSTRAINT "stack_components_stack_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."stacks"("id") ON DELETE cascade;
ALTER TABLE "stack_components" ADD CONSTRAINT "stack_components_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict;
ALTER TABLE "stack_components" ADD CONSTRAINT "stack_components_managed_database_id_fk" FOREIGN KEY ("managed_database_id") REFERENCES "public"."managed_databases"("id") ON DELETE restrict;
ALTER TABLE "component_relationships" ADD CONSTRAINT "component_relationships_stack_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."stacks"("id") ON DELETE cascade;
ALTER TABLE "component_relationships" ADD CONSTRAINT "component_relationships_source_component_id_fk" FOREIGN KEY ("source_component_id") REFERENCES "public"."stack_components"("id") ON DELETE cascade;
ALTER TABLE "component_relationships" ADD CONSTRAINT "component_relationships_target_component_id_fk" FOREIGN KEY ("target_component_id") REFERENCES "public"."stack_components"("id") ON DELETE cascade;
ALTER TABLE "service_bindings" ADD CONSTRAINT "service_bindings_stack_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."stacks"("id") ON DELETE cascade;
ALTER TABLE "service_bindings" ADD CONSTRAINT "service_bindings_consumer_component_id_fk" FOREIGN KEY ("consumer_component_id") REFERENCES "public"."stack_components"("id") ON DELETE cascade;
ALTER TABLE "service_bindings" ADD CONSTRAINT "service_bindings_provider_component_id_fk" FOREIGN KEY ("provider_component_id") REFERENCES "public"."stack_components"("id") ON DELETE cascade;
ALTER TABLE "scaling_policies" ADD CONSTRAINT "scaling_policies_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."stack_components"("id") ON DELETE cascade;
ALTER TABLE "placement_policies" ADD CONSTRAINT "placement_policies_stack_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."stacks"("id") ON DELETE cascade;
ALTER TABLE "placement_policies" ADD CONSTRAINT "placement_policies_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."stack_components"("id") ON DELETE cascade;
ALTER TABLE "stack_operations" ADD CONSTRAINT "stack_operations_stack_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."stacks"("id") ON DELETE cascade;
ALTER TABLE "stack_operations" ADD CONSTRAINT "stack_operations_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null;
ALTER TABLE "stack_operations" ADD CONSTRAINT "stack_operations_current_component_id_fk" FOREIGN KEY ("current_component_id") REFERENCES "public"."stack_components"("id") ON DELETE set null;
ALTER TABLE "stack_operations" ADD CONSTRAINT "stack_operations_current_task_id_fk" FOREIGN KEY ("current_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null;

CREATE UNIQUE INDEX "stack_blueprints_project_slug_uq" ON "stack_blueprints" USING btree ("project_id", "slug");
CREATE INDEX "stack_blueprints_status_idx" ON "stack_blueprints" USING btree ("status");
CREATE UNIQUE INDEX "stacks_project_name_uq" ON "stacks" USING btree ("project_id", "name");
CREATE INDEX "stacks_project_created_idx" ON "stacks" USING btree ("project_id", "created_at");
CREATE UNIQUE INDEX "stack_components_stack_key_uq" ON "stack_components" USING btree ("stack_id", "key");
CREATE UNIQUE INDEX "stack_components_server_uq" ON "stack_components" USING btree ("server_id") WHERE "server_id" IS NOT NULL;
CREATE UNIQUE INDEX "stack_components_database_uq" ON "stack_components" USING btree ("managed_database_id") WHERE "managed_database_id" IS NOT NULL;
CREATE INDEX "stack_components_stack_idx" ON "stack_components" USING btree ("stack_id");
CREATE UNIQUE INDEX "component_relationships_edge_uq" ON "component_relationships" USING btree ("source_component_id", "target_component_id", "type");
CREATE INDEX "component_relationships_stack_idx" ON "component_relationships" USING btree ("stack_id");
CREATE UNIQUE INDEX "service_bindings_consumer_name_uq" ON "service_bindings" USING btree ("consumer_component_id", "logical_name");
CREATE INDEX "service_bindings_stack_idx" ON "service_bindings" USING btree ("stack_id");
CREATE INDEX "placement_policies_stack_idx" ON "placement_policies" USING btree ("stack_id");
CREATE INDEX "stack_operations_stack_created_idx" ON "stack_operations" USING btree ("stack_id", "created_at");
CREATE UNIQUE INDEX "stack_operations_one_active_uq" ON "stack_operations" USING btree ("stack_id") WHERE "status" IN ('QUEUED', 'RUNNING');

INSERT INTO "stack_blueprints" ("id", "name", "slug", "description", "ecosystem", "status", "definition") VALUES
('10000000-0000-4000-8000-000000000001', 'Custom Stack', 'custom-stack', 'Compose arbitrary existing deployments, databases and services through the generic Stack model.', 'GENERIC', 'READY', '{"components":[],"relationships":[],"capabilities":["existing-resources","dependency-lifecycle","service-bindings"]}'::jsonb),
('10000000-0000-4000-8000-000000000002', 'Minecraft Network', 'minecraft-network', 'Velocity, backend groups, cache and database through Minecraft-specific installers on the generic Stack core.', 'MINECRAFT', 'PREVIEW', '{"components":["proxy","lobby","game-group","cache","database"],"relationships":["PROXY_FOR","DISCOVERS","USES_CACHE","USES_DATABASE"]}'::jsonb),
('10000000-0000-4000-8000-000000000003', 'FiveM RP', 'fivem-rp', 'FXServer and optional supporting services without assuming a specific roleplay framework.', 'FIVEM', 'PREVIEW', '{"components":["fxserver","database","cache"],"relationships":["USES_DATABASE","USES_CACHE"]}'::jsonb),
('10000000-0000-4000-8000-000000000004', 'Rust Community', 'rust-community', 'Rust Dedicated, management and backup lifecycle as a materially different orchestration target.', 'RUST', 'PLANNED', '{"components":["rust-server"],"relationships":[]}'::jsonb)
ON CONFLICT ("id") DO NOTHING;
