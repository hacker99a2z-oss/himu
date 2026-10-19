---
name: External package deployments
description: Avoid Replit-internal package registry URLs in lockfiles used by external hosts.
---

When a project is built outside Replit, check package-lock resolved URLs for Replit-internal hostnames. External services such as Render cannot resolve `package-firewall.replit.internal`; use the official package registry URL while preserving the package integrity hash.

**Why:** A lockfile can capture a Replit-only download address even when the package is public. External CI then fails with DNS errors before the build starts.

**How to apply:** Before publishing to an external host, verify resolved package hosts are public and run the production build using the same lockfile and install command as the host.
