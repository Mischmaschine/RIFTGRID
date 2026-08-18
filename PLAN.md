# RIFTGRID delivery plan

Updated: 2026-08-18

## Product boundary

RIFTGRID is a desired-state control plane for persistent game workloads on administrator-provided Kubernetes infrastructure. PostgreSQL is authoritative, Redis transports work and progress events, Kubernetes runs workloads, installer packages define deployment/configuration, and game adapters provide runtime-specific health and operations.

## DONE

- Built the pnpm/Turborepo TypeScript monorepo with Next.js web, Fastify API, BullMQ worker, PostgreSQL/Drizzle persistence, Kubernetes integration, and a versioned installer/adapter SDK.
- Preserved the existing Minecraft workload, world, configuration, StatefulSet, service, and 5 GiB PVC while evolving the product architecture.
- Reconciled the stale persisted Minecraft state through the existing task path. The previously interrupted reconciliation now reports `SUCCESS`, and `survival-01` reports `RUNNING` in RIFTGRID and the UI.
- Separated installers from adapters. Installers own manifests, schema-driven configuration, supported versions, and workload definitions; adapters own runtime-specific health and operational behavior.
- Added a versioned installer manifest and registry with provenance/status metadata and APIs for installer catalog, detail, and supported versions.
- Added additive database identity for `installer_id` and `installer_version`; the existing Minecraft row was backfilled without recreating its workload or storage.
- Added installer-first deployment with no default selection and real configuration flows for Minecraft, Custom Docker/OCI, and FiveM.
- Added generic Custom Deployment support for image, command/arguments, ports, environment variables, existing Kubernetes Secret references, persistent mounts, TCP/HTTP health checks, placement, and resource limits.
- Proved the generic path end to end by deploying `custom-web-01` from `nginx:1.27-alpine` through the same API, task, control-plane, scheduler, StatefulSet, PVC, service, and status pipeline used by Minecraft.
- Implemented the first-party FiveM installer/adapter and a Debian-based runtime image that downloads an explicit official artifact, clones official `cfx-server-data`, launches bundled txAdmin/FXServer, and requires the Cfx.re key from an existing Kubernetes Secret.
- Reorganized navigation into Deployments, Infrastructure, Operations, Extensions, and Administration. Unimplemented destinations are disabled with explanatory tooltips rather than fake pages or repeated `SOON` labels.
- Replaced placeholder screens with live Installers, Tasks, Activity, Storage, Network, Game Adapters, and Cluster pages backed by API/Kubernetes data.
- Added a real control-plane Overview with cluster health, deployment counts, player data where the adapter supports it, node CPU/RAM/storage capacity, tasks, warnings, deployment state, and recent activity.
- Finished the generic six-stage deployment wizard (`SOURCE` through `REVIEW`) with installer-driven Minecraft, Custom OCI, and FiveM configuration, organization resource limits, real placement candidates, network/storage review, and no default installer selection.
- Implemented persisted deployment templates, including creation from an existing deployment and hydration back into the generic wizard. The live `minecraft-standard` template was saved and loaded successfully without creating another workload.
- Added immutable template revisions with automatic revision snapshots on create/update, revision history, safe restore-as-new-revision, audit events, and additive backfill of existing templates as revision 1. The Deploy review can now save its current installer configuration directly as a reusable template without creating a workload.
- Added real installer detail pages backed by Installer Registry and organization usage data. They expose resolved versions, publisher/provenance, runtime/delivery/storage/network/health contracts, adapter capabilities, related templates, and related deployments without inventing community registry content.
- Promoted the planned Rust and Valheim catalog entries to deployable first-party installers. Both now have validated configuration, SteamCMD delivery, Secret-backed credentials, collision-safe public ports, persistent storage, health probes, complete wizard hydration/template support, and locally built runtime images.
- Added a SimpleCloud-style guided Linux bootstrap: one copyable Bash command now leads through host/cluster configuration, prerequisite consent, safe checkout, k3d setup, secret generation, database migration, control-plane startup, runtime-image import and end-to-end health verification. The companion `riftgrid` CLI provides status, logs, lifecycle, update and doctor commands without deleting persistent data.
- Implemented real persistent backups through tasks, the worker, Kubernetes data jobs, a dedicated per-server backup PVC, SHA-256 checksums, manual and scheduled policies, restore/delete operations, and count/age retention. Failed archive creation now performs best-effort partial-archive cleanup while preserving diagnostic history.
- Implemented managed MariaDB 11.8/MySQL 8.4 resources with Kubernetes Secret, PVC, ClusterIP Service, StatefulSet, real lifecycle observation, association to a deployment, and no password disclosure through the API or UI.
- Implemented real Users/RBAC and organization Settings pages with enable/disable, role updates, last-super-admin/self-lockout protection, deployment defaults/maximums, backup defaults, and installer channel persistence.
- Implemented real node policy mutation for maintenance/scheduling, expanded cluster/node/network/storage inventory, and adapter-aware console transport so FiveM logs cannot accidentally receive Minecraft RCON commands.
- Added an optional FiveM managed-database binding. Connection metadata is supplied as runtime environment, while `DATABASE_PASSWORD` remains a Kubernetes Secret reference.
- Diagnosed and fixed the pathological Windows pnpm relink without weakening Defender. The initiating defect was interrupted/concurrent install metadata; Defender amplified small-file work. The store was valid, the workspace graph was acyclic, and the linker configuration was stabilized with a project-local store and no implicit install-on-run.
- Kept production and development Next.js outputs separate and retained the Minecraft JVM headroom fix that prevents the prior 2 GiB-container OOM restart.
- Integrated the supplied RIFTGRID V6 commercial site as the public root landing page. Its HTML, CSS, JavaScript, copy, and visuals are preserved byte-for-byte; the existing product console remains available at `/dashboard` and `/login`.
- Hardened Kubernetes event timestamp normalization for Windows/Docker resume scenarios and preserved live per-node workload counts in the overview API instead of discarding them after discovery.
- Expanded the FiveM server page into an operations cockpit with live public FXServer player/resource data, pod uptime/readiness/restarts, dynamic capability tabs, configuration with secret redaction, backups, activity, performance signals, quick actions, and searchable/filterable/exportable console logs.
- Added the first game-agnostic Stack orchestration vertical slice: persisted Stacks, Blueprints, Components, generic typed Relationships, logical Service Bindings, Scaling Policies, Placement Policies and coordinated Stack Operations.
- Added a pure generic dependency engine with cycle rejection, provider-first startup, consumer-first shutdown, two-phase restart and aggregate dependency health. It contains no Minecraft-, FiveM- or Rust-specific rules.
- Added a generic adapter orchestration capability contract plus optional population and backup command plans. Minecraft player/save commands now live in the Minecraft adapter instead of the control-plane/Overview core; the Kubernetes Service type setting is game-neutral with backward-compatible configuration fallback.
- Added RBAC-protected Stack APIs for Blueprint catalog, composition from real existing deployments/databases, live graph detail, lifecycle requests and metadata-only Stack deletion that never deletes referenced resources.
- Added a worker-driven Stack lifecycle executor that reuses existing audited deployment tasks, waits for each required component before advancing and also coordinates managed database readiness.
- Added real `Deploy Stack`, Stack inventory and Stack detail UI with live component state, placement, resources, ports, active tasks, dependency edges, operation progress and Kubernetes DNS service bindings.
- Added a guided, short-lived remote k3s node enrollment flow for Ubuntu/Debian nodes with hidden token prompts, hashed enrollment credentials, automatic Kubernetes discovery and no overwrite of an existing agent installation.

## IN PROGRESS

- FiveM read-only operations are live. Authenticated player actions, resource lifecycle commands, writable console transport, and versioned `server.cfg` editing still require the scoped RIFTGRID FiveM bridge; undocumented txAdmin routes are deliberately not used.
- Backup restore is implemented and constrained to a stopped workload. Its live acceptance remains pending; no restore or source-data replacement was performed during installer/template work.
- Stack Blueprint instantiation currently adopts existing real resources. Creating all component deployments directly from Blueprint definitions, injecting resolved bindings into newly created workloads and coordinated Stack backups are the next Stack slices.

## VERIFIED

- Minecraft `survival-01` completed its live acceptance as RIFTGRID/UI `RUNNING`; StatefulSet `rg-73ae6d88-13e` was `1/1` and the pod was `1/1 Ready`. At the end of the installer/template milestone, a later authenticated `STOP_SERVER` request completed successfully and the existing StatefulSet is now deliberately scaled to `0/0`.
- Its original PVC `rg-73ae6d88-13e` remains `Bound` to PV `pvc-f433b1c8-ee7d-416c-b302-c6610a5edffe`, 5 GiB, and mounted by the same StatefulSet. `/data/world/level.dat` and `/data/server.properties` are present.
- Minecraft service remains `25565:30000/TCP`; `localhost:30000` was reachable while the deployment was running. Previously saved world/configuration data, including the accepted world-border persistence check, was preserved; its original PVC remains `Bound` while stopped.
- Generic `custom-web-01` completed live acceptance as RIFTGRID `RUNNING`, pod `1/1 Ready`, 0 restarts, and HTTP 200 on `localhost:30001`. A later authenticated `STOP_SERVER` task completed successfully; its existing StatefulSet is `0/0` and its original 5 GiB PVC remains `Bound`.
- Managed MariaDB acceptance completed through RIFTGRID: `test-db` was provisioned, reached `RUNNING`, and was then stopped through the normal UI action. StatefulSet `db-8600c5ea-61c` is intentionally scaled to 0 and its original 5 GiB PVC remains `Bound`.
- A real Minecraft archive `rg-73ae6d88-13e-63327387-e1a9-41b1-b950-97744703932b.tar.gz` completed as `AVAILABLE` at 222.3 MiB with SHA-256 `8fec1695656efde6cd236168148d1951ae817ef630532ac8e3a7138ebe04b8af` on the bound 10 GiB backup claim `bk-rg-73ae6d88-13e`.
- The initial archive attempt exposed read permissions on mode-0600 Minecraft files. The backup job was narrowed to `DAC_READ_SEARCH`, a second real backup succeeded, and Minecraft returned to `RUNNING`; no source PVC was replaced.
- After the stopped-workload restore precondition test was cancelled by browser policy before restore execution, Minecraft was started normally. The live RIFTGRID UI reports `RUNNING`/desired `RUNNING`; `localhost:30000` is reachable, and `custom-web-01` still returns HTTP 200 on `localhost:30001`.
- FiveM version discovery resolves the current official `LATEST RECOMMENDED` Linux artifact (build 25770 at verification time), and the local `riftgrid/fivem-server:0.1.0` image was built and imported into all three existing k3d nodes without restarting them.
- The FiveM runtime fails safely when its artifact URL or Secret-backed `CFX_LICENSE_KEY` is absent, and the UI cannot submit until a Secret name is provided.
- The live UI was inspected for the installer catalog, deploy flows, server identity, tasks, activity, storage, networking, adapters, cluster state, and disabled unfinished destinations.
- Database migration completed successfully. No pnpm reinstall, workspace relink, cluster recreation, PVC replacement, or Minecraft recreation was performed.
- After the landing-page and live-overview fixes, quality gates ran sequentially and passed: typecheck 12/12 tasks; lint 12/12 tasks; tests 21/21 tasks with 25 assertions; build 12/12 tasks with 22 application pages generated.
- The production build used Next.js's supported WASM fallback because the optional native Windows SWC DLL could not load; the build completed successfully.
- The public `/` route, all supplied static assets, and the existing `/dashboard` were verified live. Browser console errors: 0. Node workload counts report `1`, `1`, and `0` for the two agents and control-plane node.
- FiveM `riftgrid-fivem` completed live acceptance as RIFTGRID `RUNNING`, pod `1/1 Ready`, 0 restarts, with 0/48 players and 82 started resources. A later authenticated `STOP_SERVER` task completed successfully; its existing StatefulSet is `0/0`, endpoints remain allocated, and the original 21 GiB PVC remains `Bound`.
- Installer/template milestone: migration `0004_template_revisions` applied; existing `minecraft-standard` is revision 1; history and template-to-deploy hydration were verified live; FiveM installer detail resolves build 25770, seven adapter capabilities, three default ports, and its real deployment usage. No deployment or restore task was created.
- Post-milestone quality gates passed sequentially: typecheck 12/12, lint 12/12, tests 21/21 tasks, build 12/12 with 23 application pages including `/dashboard/installers/[id]`.
- Three authenticated stop requests arrived after acceptance (FiveM, Custom OCI, then Minecraft) and completed normally. They were not crash/restart events and did not delete or replace workloads or storage; all game, database, and backup PVCs remain `Bound`. The current audit schema records actor and action but not HTTP client provenance, so the initiating browser/client cannot be identified more narrowly after the fact.
- Rust and Valheim installer manifests now report `READY`, their configuration forms were verified live, and `riftgrid/rust-server:0.1.0` plus `riftgrid/valheim-server:0.1.0` were built successfully and imported into all three existing k3d nodes. No Rust/Valheim deployment, task, Service, StatefulSet or PVC was created during this work.
- Post-Rust/Valheim quality gates passed sequentially: typecheck 12/12, lint 12/12, tests 21/21 tasks including 11 Installer SDK assertions, and build 12/12 with 22 application routes.
- A separate authenticated client concurrently created `test-mc`, reached `RUNNING`, and then stopped it through normal RIFTGRID tasks. Its StatefulSet is `0/0` and its independently created 10 GiB PVC is `Bound`; it was not part of the Rust/Valheim acceptance and was left untouched.
- Stack migration `0007_stack_orchestration` applied additively. The live UI created `survival-infrastructure` around the existing `survival-01` deployment and its already linked `test-db` MariaDB without recreating or restarting either resource.
- The real Stack graph reports aggregate `DEGRADED` because `survival-01` is `RUNNING` while its required database dependency is deliberately `STOPPED`; it resolves the logical `database` binding to `db-8600c5ea-61c.riftgrid-servers.svc.cluster.local` and shows the required `USES_DATABASE` lifecycle edge.
- Generic orchestration tests pass for provider-first start, reverse stop, two-phase restart, cycle rejection and required-component aggregate health. The Stack pages and graph were inspected in the running application; no Stack lifecycle action was invoked during acceptance.
- Post-Stack quality gates passed sequentially: typecheck 12/12 tasks, lint 12/12 tasks, tests 21/21 tasks, and build 12/12 tasks with 25 application pages. The Node enrollment installer test is isolated from database startup through a pure script-generator module.

## BLOCKED

- No current external dependency blocks the next implementation slice.

## NEXT

1. Expand `Deploy Stack` from safe adoption into transactional Blueprint instantiation of new components, while retaining rollback boundaries and idempotency per deployment.
2. Inject declared Service Bindings into Blueprint-created workloads as structured environment references and add stack-scoped Kubernetes aliases where stable logical names require them.
3. Implement generic Instance Groups and persisted Scaling Policies; add the adapter population/safe-disposal contract before enabling player-aware scale-down.
4. Upgrade node maintenance to classify Stack workloads as `SAFE_TO_MOVE`, `WAIT_FOR_EMPTY`, `PERSISTENT_MIGRATION_REQUIRED` or `BLOCKED` with explainable reasons.
5. Promote Minecraft Network and FiveM RP from honest `PREVIEW` Blueprints only after their installer-specific component definitions work through the same generic core; validate Rust as the third materially different ecosystem.
6. Add an RBAC-protected, audited Secrets area so FiveM, Rust, Valheim and Custom OCI credentials can be created/rotated through RIFTGRID without exposing stored values.
7. Implement the authenticated RIFTGRID FiveM bridge and continue the Minecraft operations surface without moving their runtime-specific behavior into Stack core.

## KNOWN LIMITATIONS

- The FiveM runtime image is currently built/imported locally for this development k3d cluster; it is not yet published to a production registry or pinned by digest.
- Rust and Valheim runtime images are likewise local development artifacts and are not yet published or digest-pinned. Their first full game-download/start/client acceptance remains pending and requires administrator-created Kubernetes Secrets for WebRCON/server access.
- FiveM player/resource mutations, interactive console commands, and `server.cfg` writes are intentionally unavailable until the authenticated bridge exists. Read-only runtime inventory and Kubernetes lifecycle operations are real.
- Installer manifests validate runtime configuration, but the deploy wizard still contains presentation branches for Minecraft, FiveM, and Custom OCI; schema-driven installer UI metadata remains the next Installer Engine refactor.
- Custom Deployment Secret references require the named Kubernetes Secret to exist in `riftgrid-servers`; RIFTGRID does not create secrets from plaintext in the deployment form.
- The first failed backup remains visible as diagnostic history; its pre-fix partial archive was created before best-effort failure cleanup existed. It can be removed through the explicit Backups delete action when desired.
- Live restore acceptance remains pending because it is an explicitly destructive data operation and must only be started through its deliberate UI confirmation while Minecraft is stopped.
- Global search, notifications/profile actions, server migration/reinstall/delete, file management, server groups/autoscaling, Velocity service discovery and production-grade metrics remain roadmap work; their UI is not presented as completed functionality.
- NodePort allocation is suitable for the current local development cluster. Production ingress/load-balancing, TLS, observability, CSI-native snapshots, and external PostgreSQL/Redis secret management remain deployment-hardening work.
- `Deploy Stack` currently composes existing deployments and managed databases; it does not yet create all Blueprint components in one transaction. Minecraft Network and FiveM RP remain visibly `PREVIEW`, and Rust Community remains `PLANNED`.
- Service Bindings already resolve logical names to real Kubernetes DNS addresses in Stack API/UI, but automatic environment injection is limited to future Blueprint-created workloads; existing adopted workloads are not rewritten or restarted.
- Stack lifecycle execution is implemented but acceptance deliberately did not start, stop or restart the preserved reference workloads. Coordinated Stack backup, Instance Groups, player-aware scaling and maintenance migration classification remain the next orchestration milestones.
