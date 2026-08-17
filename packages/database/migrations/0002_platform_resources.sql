CREATE TYPE "public"."backup_status" AS ENUM('QUEUED', 'CREATING', 'AVAILABLE', 'RESTORING', 'FAILED', 'DELETING');
CREATE TYPE "public"."backup_trigger" AS ENUM('MANUAL', 'SCHEDULED');
CREATE TYPE "public"."database_engine" AS ENUM('MARIADB', 'MYSQL');
CREATE TYPE "public"."managed_database_state" AS ENUM('PROVISIONING', 'RUNNING', 'STOPPED', 'FAILED');

ALTER TABLE "users" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

CREATE TABLE "deployment_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "installer_id" text NOT NULL,
  "installer_version" text NOT NULL,
  "configuration" jsonb NOT NULL,
  "cpu_millicores" integer NOT NULL,
  "memory_mib" integer NOT NULL,
  "storage_gib" integer NOT NULL,
  "placement" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "deployment_templates" ADD CONSTRAINT "deployment_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
ALTER TABLE "deployment_templates" ADD CONSTRAINT "deployment_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE UNIQUE INDEX "deployment_templates_project_name_uq" ON "deployment_templates" USING btree ("project_id", "name");
CREATE INDEX "deployment_templates_installer_idx" ON "deployment_templates" USING btree ("installer_id");

CREATE TABLE "backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "server_id" uuid NOT NULL,
  "requested_by" uuid,
  "status" "backup_status" DEFAULT 'QUEUED' NOT NULL,
  "trigger" "backup_trigger" DEFAULT 'MANUAL' NOT NULL,
  "archive_name" text NOT NULL,
  "size_bytes" bigint,
  "checksum" text,
  "error_message" text,
  "retention_days" integer DEFAULT 14 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "backups_archive_name_unique" UNIQUE("archive_name")
);
ALTER TABLE "backups" ADD CONSTRAINT "backups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade;
ALTER TABLE "backups" ADD CONSTRAINT "backups_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE INDEX "backups_server_created_idx" ON "backups" USING btree ("server_id", "created_at");
CREATE INDEX "backups_status_idx" ON "backups" USING btree ("status");

CREATE TABLE "backup_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "server_id" uuid NOT NULL UNIQUE,
  "enabled" boolean DEFAULT false NOT NULL,
  "schedule" text DEFAULT '0 3 * * *' NOT NULL,
  "retention_days" integer DEFAULT 14 NOT NULL,
  "retention_count" integer DEFAULT 7 NOT NULL,
  "next_run_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade;

CREATE TABLE "managed_databases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "server_id" uuid,
  "name" text NOT NULL,
  "engine" "database_engine" NOT NULL,
  "database_name" text NOT NULL,
  "username" text NOT NULL,
  "password_secret_name" text NOT NULL,
  "kubernetes_name" text NOT NULL,
  "host" text NOT NULL,
  "port" integer DEFAULT 3306 NOT NULL,
  "storage_gib" integer DEFAULT 5 NOT NULL,
  "state" "managed_database_state" DEFAULT 'PROVISIONING' NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "managed_databases_kubernetes_name_unique" UNIQUE("kubernetes_name")
);
ALTER TABLE "managed_databases" ADD CONSTRAINT "managed_databases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
ALTER TABLE "managed_databases" ADD CONSTRAINT "managed_databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null;
CREATE UNIQUE INDEX "managed_databases_project_name_uq" ON "managed_databases" USING btree ("project_id", "name");
CREATE INDEX "managed_databases_server_idx" ON "managed_databases" USING btree ("server_id");

CREATE TABLE "organization_settings" (
  "organization_id" uuid PRIMARY KEY NOT NULL,
  "default_placement" text DEFAULT 'AUTOMATIC' NOT NULL,
  "default_cpu_millicores" integer DEFAULT 2000 NOT NULL,
  "default_memory_mib" integer DEFAULT 4096 NOT NULL,
  "default_storage_gib" integer DEFAULT 10 NOT NULL,
  "maximum_cpu_millicores" integer DEFAULT 16000 NOT NULL,
  "maximum_memory_mib" integer DEFAULT 65536 NOT NULL,
  "maximum_storage_gib" integer DEFAULT 250 NOT NULL,
  "backup_retention_days" integer DEFAULT 14 NOT NULL,
  "backup_retention_count" integer DEFAULT 7 NOT NULL,
  "installer_channel" text DEFAULT 'STABLE' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
