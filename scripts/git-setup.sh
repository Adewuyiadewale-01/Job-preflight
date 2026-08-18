#!/usr/bin/env bash
# One-shot local git setup for Application Mail Preflight.
# Creates small, logical commits and pushes to the target repository.
#
# Usage:  bash scripts/git-setup.sh
# Requires: git, and GitHub auth (gh auth login, SSH key, or credential helper).

set -euo pipefail

REMOTE_URL="https://github.com/Adewuyiadewale-01/job-mailboxes-preflight.git"

if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Git repository already initialized — skipping init and commits."
else
  git init -b main

  # 1 — scaffold & configuration
  git add .gitignore .env.example index.html package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.js vitest.config.ts
  git commit -m "chore: scaffold Vite + React + TypeScript + Tailwind project"

  # 2 — shared core domain logic (single source of truth for demo + live)
  git add shared src/lib/types.ts src/lib/utils.ts src/lib/verdict.ts
  git commit -m "feat(core): recipient allowlist gate, verdict rules, auth-header parsing"

  # 3 — demo pipeline engine & persistence
  git add src/lib/engine.ts src/lib/store.ts
  git commit -m "feat(core): simulated preflight pipeline and persistent local store"

  # 4 — local backend (SMTP, adapters, OAuth, encryption, polling, SQLite)
  git add server
  git commit -m "feat(server): live-mode backend with mock adapters and dummy env defaults"

  # 5 — unit tests
  git add src/lib/preflight.test.ts
  git commit -m "test: allowlist, verdict, auth parsing, SMTP, crypto, OAuth, orchestrator"

  # 5 — UI foundation
  git add src/index.css src/main.tsx src/components/ui.tsx src/components/Layout.tsx src/components/RunReport.tsx
  git commit -m "feat(ui): design system, app shell, run report renderer"

  # 6 — pages
  git add src/pages
  git commit -m "feat(ui): preflight console, applications tracker, mailboxes, settings"

  # 7 — entry wiring & docs
  git add src/App.tsx README.md scripts
  git commit -m "feat: wire app entry, README with setup and production notes"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git push -u origin main
echo ""
echo "Pushed to $REMOTE_URL"
