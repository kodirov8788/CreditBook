<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CreditBook Agent Guide

## Product

- Mobile-first Uzbek credit ledger for small shops.
- Stack: Next.js App Router, TypeScript, Supabase Auth/PostgreSQL, and Vercel.
- Preserve Uzbek product UI; use English for code, docs, and agent reports unless Ali requests otherwise.

## Start every session

1. Work from this repository root, never from the `claude-work` parent.
2. Run `git status --short --branch`; preserve unrelated and generated changes.
3. Read `README.md`, relevant repository docs, then `/Users/Kodirovdev/Desktop/OBSIDIAN-ROOT/20-projects/creditbook/` in `CONTEXT.md → STATE.md → DECISIONS.md → ERRORS.md → TODO.md → HANDOFF.md` order.
4. Treat vault notes as continuity; current Git, code, tests, and live services outrank stale notes.

## Memory and subagents

- One manager owns scope, integration, verification, and durable-memory updates.
- Use at most two subagents for independent bounded research, review, or verification; require evidence and a stopping condition.
- Subagents return candidate notes; only the manager writes approved durable-memory updates.
- Never store secrets, `.env` values, credentials, customer data, or raw transcripts in instructions or memory.

## Engineering constraints

- Read the installed Next.js documentation before changing framework behavior.
- Preserve tenant isolation, RLS, role boundaries, atomic financial writes, and audit integrity.
- Never auto-promote the first user to platform owner.
- An unauthenticated `401` smoke check is not authenticated production acceptance.

## Approval and verification

- Default to review only; show the proposed diff before editing existing files.
- Get explicit approval before edits/deletes, dependencies, builds, state-changing tests, migrations, commits, pushes, GitHub mutations, deployments, or production-data changes.
- After approved changes, run only relevant checks from `typecheck`, `lint`, `test:api`, `build`, and `test:e2e`.
- Record commands, results, skipped checks, deployment evidence, and unresolved risks.

## Documented release targets

- GitHub: `kodirov8788/CreditBook`.
- Vercel project: `creditbook`; do not use retired `credit-book` without fresh evidence.
- Supabase project ref: `txikcclndkierygbiblu`; identifiers are not credentials.
- Recheck live deployment and migration state before making release claims.
