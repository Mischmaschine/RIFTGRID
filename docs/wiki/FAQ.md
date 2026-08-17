# Frequently Asked Questions

## Is RIFTGRID a hosting provider?

No. It is self-hosted control-plane software. You provide and operate the Kubernetes infrastructure.

## Is Minecraft hard-coded into the core?

No. Minecraft is a first-party installer and adapter. Universal scheduling, storage, networking, tasks, and state transitions remain game-independent.

## Can I run software that has no RIFTGRID installer?

Yes. Custom Docker deployments accept an image, command, arguments, ports, environment, Secret references, persistent storage, resource limits, and health checks.

## What is the difference between an installer and an adapter?

An installer describes how software reaches `RUNNING`. An adapter adds game-aware behavior such as players, worlds, resources, configuration, health, and console commands.

## Does reconciliation replace my world or PVC?

Normal reconciliation preserves persistent storage identity. Destructive operations require an explicit workflow and appropriate preconditions.

## Why does FiveM need a Secret?

Cfx.re requires a server registration/license key. RIFTGRID accepts only a reference to an existing Kubernetes Secret so the key is not persisted in ordinary configuration or logs.

## Can quality checks run concurrently?

They can on many systems, but the documented Windows workflow runs typecheck, lint, tests, and build sequentially to avoid redundant filesystem pressure.
