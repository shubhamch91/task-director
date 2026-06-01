# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Task Director** — a personal kanban board (Backlog / In Progress / Done) with a Marathon/M7 dark aesthetic. Deployed at `https://<user>.github.io/marathon-scrum-board/`.

Location on disk: `/Users/shubham/Documents/marathon-scrum-board/`

## Stack

- Pure static HTML + vanilla JS — no build step, no package.json
- Tailwind CSS loaded from CDN (with `forms` and `container-queries` plugins)
- JetBrains Mono font from Google Fonts
- Supabase REST API called directly via `fetch` (no Supabase SDK)

To run locally: `open index.html` or `python3 -m http.server` from the project root. There is no build or lint command.

## Architecture

All logic lives in two files:

- `index.html` — markup for both views + inline Tailwind config + CSS overrides
- `app.js` — all state, rendering, and Supabase calls

**Dual-view layout**: The app renders a desktop view (`#desktop-view`, hidden below `lg:`) and a mobile view (`#mobile-view`, hidden above `lg:`) simultaneously. Both views share the same in-memory state (`taskState`, `spacesState`) and are re-rendered together on every mutation via a single `render()` call.

**State model**: tasks are stored in `taskState[]` and spaces in `spacesState[]`. All writes are optimistic — state is mutated and `render()` is called immediately, then the Supabase PATCH/POST/DELETE fires without awaiting the result (except on create, where the returned `task_number` is patched back in).

**Table routing**: The correct Supabase table is selected at runtime based on hostname:
- `github.io` → `tasks` / `spaces` (production)
- anything else → `tasks_dev` / `spaces_dev` (local dev)

Never hardcode the table name — always use the `DB_TABLE` / `SPACES_TABLE` constants.

**Spaces** are a desktop-only feature. Mobile renders all tasks across spaces without filtering. `activeSpaceId` controls which space is shown on desktop.

**Mobile UX specifics**: Cards use `ontouchend` (not `onclick`) for action buttons to avoid scroll-triggered ghost taps — guarded by `isTap()`. The create sheet slides up from the bottom via CSS class toggling on `#create-sheet-root`.
