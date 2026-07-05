# Inspirations Farm 🌱

> 🌐 Languages: **English** | [简体中文](README.zh-CN.md)  
> 🏷️ Version: **v1.0.0**

A mobile-first PWA personal inspiration management system. GitHub-backed headless CMS, installable on your phone home screen.

**Live**: [todo.alanevergarden.xyz](https://todo.alanevergarden.xyz)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| UI | React 19 + Tailwind CSS v4 |
| Components | shadcn/ui (base-nova) + Base UI React primitives |
| Icons | lucide-react |
| Markdown | gray-matter (frontmatter) + `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` (KaTeX) |
| Markdown AST | `mdast-util-from-markdown` + `micromark-extension-frontmatter` + `mdast-util-frontmatter` (code-block-safe section location) |
| Backend/CMS | GitHub REST API (Markdown files) |
| Auth | PIN lock screen + Cron secret |
| PWA | manifest + service worker (production only) |
| Cron | Vercel Cron Jobs |
| Deploy | Vercel |

## Features

- **🔐 PIN Lock Screen** — 4-6 digit access code, 401 auto-lockout
- **📝 Inspiration Pool** — capture ideas with timestamped filenames, YAML frontmatter
- **🏷️ Priority & Tags** — p0–p3 priority border + tag pills with filter bar
- **📅 Daily Dashboard** — journal with nested task checkboxes, parent-child cascade logic
- **🔗 Inspiration → Task Linking** — push inspirations to today's journal as `[[timestamp|title]]` wiki-links; backend dedup prevents double-entry; push button shows spinner + success/duplicate feedback
- **✅ Cascade Archive** — completing a linked task auto-archives the inspiration (both via web toggle and Obsidian-side reconciliation on next page load)
- **⏳ Relative Time** — Beijing-timezone-aware "X小时前" labels
- **🌳 Nested Tasks** — markdown indent-parsed tree with parent-child cascade toggle (line-based, avoids false String.replace matches); supports `-`, `*`, `+` task-list markers
- **🔄 Daily Rollover** — tree-based splitting preserves parent-child relationships; `🔄` marker tags rolled-over tasks so the frontend highlights them with an amber "延期" badge
- **🏷️ Rollover Badge** — tasks carried over from yesterday render a `延期` badge (`bg-amber-100 text-amber-700`), visually distinguishing legacy items from today's new tasks
- **📝 Inspiration Patches** — append timestamped follow-up notes to inspirations via `## 追加记录` markdown section; multi-line patch content is preserved (continuation lines no longer dropped)
- **🛡️ Code-Block-Safe Editing** — section insertion (patches, daily tasks, jottings) and parsing use mdast AST to locate headings, so a `# heading` or `---` inside a fenced code block can never mis-locate a section or corrupt the file. YAML frontmatter is parsed as a single node (YAML `#` comments aren't mistaken for headings). The rest of the file is preserved byte-for-byte (tabs, `*`/`+` bullets, blank lines) — no full re-serialize.
- **📐 CRLF-Safe Parsing** — daily journals are normalised to LF on read, so CRLF files (e.g. from Obsidian on Windows) parse tasks/notes correctly instead of being silently dropped.
- **📄 Rich Markdown Rendering** — `react-markdown` + `remark-gfm` + `@tailwindcss/typography`; prose styles for inspiration cards & jottings; inline-safe rendering for todo tasks (no prose, `<p>`→`<span>`, keeps flex layout)
- **🧮 Math Rendering** — inline `$...$` and block `$$...$$` via `remark-math` + `rehype-katex`; KaTeX CSS imported globally (`globals.css`); `output: "html"` prevents exposed MathML/source text like `{\displaystyle ...}`
- **🗒️ Daily Jottings** — timestamped notes appended to `## 今日杂记` under `# 本日总结`; rendered as a timeline on the dashboard
- **📋 Template Support** — `Templates/Diary_Template.md` fetched from GitHub at rollover time; supports `{{date}}` / `{{DATE:YYYY-MM-DD}}` and `%%TODO_PLACEHOLDER%%` placeholders; path configurable via `DIARY_TEMPLATE_PATH` env var; falls back to built-in template on fetch failure
- **📱 PWA** — install to home screen, offline cache, standalone mode
- **📂 Headless CMS** — all data in your private GitHub repo as plain Markdown

## Architecture

The codebase is split by single-responsibility to keep the former "god object" `github.ts` maintainable:

| Module | Responsibility |
|---|---|
| `src/lib/github-client.ts` | Low-level GitHub REST client — auth/config, `githubFetch`, `withConflictRetry` (409 retry), base64 codec, raw API response types. No business logic, no markdown. |
| `src/lib/markdown-utils.ts` | Pure Markdown parse & manipulate — date-safe frontmatter, `parseTasks`/`computeParents`, `parseInspirationPatches`/`parseDailyNotes`, and the AST-based insertion helpers. No network, no GitHub. |
| `src/lib/github.ts` | High-level data service — orchestrates the client + markdown-utils into business operations (list/create/archive inspirations, daily-journal CRUD, `syncIdeasState`). Re-exports the pre-split public API so callers (API routes, server data layer, client components) are unchanged. |

**Markdown manipulation is AST-based.** Insertion and parsing helpers parse the document to an mdast tree to robustly locate headings/sections — fenced code blocks and YAML frontmatter are separate node types, so a `# heading` or `---` inside them can never mis-locate a section or corrupt the file. The new line is then spliced into the raw string at the AST-derived line index; the rest of the file is preserved byte-for-byte (no full re-serialize, so tabs, `*`/`+` bullets, and blank lines are untouched).

**Write consistency.** Daily write paths (`add task`, `add note`) go through `modifyDailyJournal`, which wraps the whole read-modify-write in `withConflictRetry` (re-GET fresh SHA + content on a 409) and adds a brief pre-read pause so GitHub's eventually-consistent read replica can catch up — preventing both 409 failures and the silent data-loss that a "fresh SHA + stale content" read can otherwise cause.

## Project Structure

```
Inspirations_Farm/
├── README.md
├── docs/DEVLOG.md
└── inspirations-farm-app/
    ├── vercel.json                       # Cron schedule
    ├── public/
    │   ├── icon.svg                      # PWA icon
    │   └── sw.js                         # Service Worker
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   ├── github/route.ts       # Inspirations CRUD + archive + patches + syncIdeas
    │   │   │   ├── daily/route.ts        # Daily journal + push-to-daily + jottings
    │   │   │   └── cron/rollover/route.ts # Rollover endpoint
    │   │   ├── layout.tsx                # PWA meta + SW registration (prod only)
    │   │   ├── page.tsx                  # Server Component shell (force-dynamic) + Suspense
    │   │   ├── home.tsx                  # Client shell: PIN lock overlay + sticky header
    │   │   ├── dashboard-content.tsx     # Async Server Component: fetch + reconciliation
    │   │   ├── dashboard-skeleton.tsx    # Suspense fallback (animate-pulse)
    │   │   ├── lock-screen.tsx           # PIN unlock
    │   │   ├── inspiration-feed.tsx      # Capture + timeline + push button
    │   │   ├── daily-dashboard.tsx       # Nested tasks + cascade + archive
    │   │   ├── jottings-card.tsx         # Daily jottings timeline + add-note
    │   │   └── manifest.ts               # → /manifest.webmanifest
    │   ├── components/ui/                # shadcn/ui (base-nova)
    │   ├── types/
    │   │   └── js-yaml.d.ts              # Minimal ambient types for js-yaml
    │   └── lib/
    │       ├── github-client.ts          # Low-level GitHub REST client (fetch, retry, base64, types)
    │       ├── markdown-utils.ts         # Pure Markdown parse/manipulate (AST-based section location)
    │       ├── github.ts                 # High-level data service (orchestrates client + markdown-utils)
    │       ├── data.ts                   # Server data layer: getTodos/getInspirations/syncCompletedIdeas
    │       ├── beijing-time.ts           # Asia/Shanghai date utilities
    │       ├── time.ts                   # Survival duration + Beijing-time parser
    │       ├── cascade.ts               # Nested task toggle cascade
    │       ├── rollover.ts              # Daily undone-task migration (tree split + merge)
    │       ├── auth.ts                   # Server-side PIN validation
    │       ├── api.ts                    # Client fetch wrapper (PIN + 401 handler)
    │       └── utils.ts                  # cn() utility
    ├── .env.example
    └── package.json
```

## Getting Started

### 1. Install

```bash
cd inspirations-farm-app
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
GITHUB_PAT=ghp_your_personal_access_token   # needs repo scope
REPO_OWNER=your-github-username
REPO_NAME=your-private-repo
APP_PIN=1234                                 # lock screen PIN (omit to skip auth)
CRON_SECRET=your-random-secret               # for Vercel Cron Job auth
DIARY_TEMPLATE_PATH=Templates/Diary_Template.md  # optional, defaults to this value
```

### 3. Repository Structure

Your GitHub repo should have these directories:

```
Inspirations/            # inspiration .md files
Journal/Daily/           # daily journal .md files
Templates/               # (optional) Diary_Template.md
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter your APP_PIN to unlock.

## API Reference

All endpoints require `x-app-pin` header (unless `APP_PIN` is unset).

### /api/github

| Method | Body | Description |
|---|---|---|
| GET | — | List active inspirations (with `id`, `title`, `content`, `patches`) |
| POST | `{ content, priority?, tags? }` | Create inspiration (`Inspirations/YYYY-MM-DD-HHmmss.md`) |
| POST | `{ action: "syncIdeas", ideaIds: string[] }` | Batch-archive inspirations (Obsidian-side reconciliation; idempotent — skips already-completed) |
| PATCH | `{ path, content }` | Append timestamped patch to `## 追加记录` section |
| PUT | `{ path, sha, status }` or `{ ideaId, status }` | Update status or archive by ideaId |
| DELETE | `{ path, sha }` | Delete inspiration |

### /api/daily

| Method | Body | Description |
|---|---|---|
| GET | `?date=YYYY-MM-DD` | Get daily journal with parsed tasks + notes |
| POST | `{ date }` | Create daily journal |
| POST | `{ ideaId, ideaTitle, date }` | Push inspiration into today's tasks (dedup: `409` if `ideaId` already present) |
| POST | `{ action: "addNote", date, content }` | Append timestamped note to `## 今日杂记` section |
| PUT | `{ path, sha, content }` | Update journal content |

### /api/cron/rollover

| Method | Auth | Description |
|---|---|---|
| GET | `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>` | Migrate undone tasks from yesterday → today |

**Query parameters:**

| Param | Value | Description |
|---|---|---|
| `secret` | `<CRON_SECRET>` | Auth via URL (alternative to Bearer header) |
| `dryRun` | `true` | Parse & build content, skip GitHub writes, return previews |
| `targetDate` | `YYYY-MM-DD` | Time-machine: set source date explicitly (target = source + 1 day) |

**Auth priority**: `NODE_ENV=development` → bypass all auth. Otherwise: `?secret=` → `Authorization` header.

**Examples:**
```
# Local safe test (dev mode — no auth needed)
/api/cron/rollover?dryRun=true

# Production dry run with URL auth
/api/cron/rollover?secret=<SECRET>&dryRun=true

# Time-machine: rollover tasks from June 30 → July 1 (source = 06-30, target = 07-01)
/api/cron/rollover?secret=<SECRET>&dryRun=true&targetDate=2026-06-30

# Real historical rollover (writes to GitHub!)
/api/cron/rollover?secret=<SECRET>&targetDate=2026-06-15
```

**Dry-run response** includes `sourcePreview`, `targetPreview`, `extractedTasks`, `sourceDate`, `targetDate`.

## Markdown File Format

All Markdown content is rendered with `react-markdown` + `remark-gfm` (GitHub Flavored Markdown) using `@tailwindcss/typography` prose styles. **Bold**, *italic*, `code`, [links](url), tables, task lists, and strikethrough are all supported.

**Inspiration** (`Inspirations/2026-06-19-113215.md`):
```markdown
---
type: inspiration
status: active
create: 2026-06-19 11:32:15
priority: p2
tags: [rust, learning]
---

# User's note content

Some additional body text...

## 追加记录

- **2026-06-20 14:30** Follow-up thought on this topic
- **2026-06-21 09:15** Another update after sleeping on it
```

**Daily Journal** (`Journal/Daily/2026-06-19.md`):
```markdown
---
tags:
  - diary
date: 2026-06-19
---
# 近期计划



---
# 当日日程

- [ ] Buy groceries
- [ ] [[2026-06-19-113215|Learn Rust]]    ← linked inspiration
    - [ ] Sub-task with 4-space indent

---
# 本日总结

## 今日杂记

- **14:30** Quick thought captured during the day
```

**Math syntax** — works in inspiration content, patches, jottings, and task text:
```markdown
Inline: $E = mc^2$

Block:
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

**Rollover behavior**: at Beijing 00:01 each day, the cron job reads **yesterday's** journal and builds a **task tree** from the `# 当日日程` section (handles `[x]`, `[ ]`, `[>]` markers at arbitrary nesting depth). The tree is then split recursively:
- **Fully done** subtrees (parent `[x]` + all descendants `[x]`) stay in yesterday as-is.
- **Partially complete** subtrees are split: done portions remain in yesterday (parent `[>]`, children `[x]`), undone portions are migrated to today (parent `[ ]`, children `[ ]`) with nesting preserved.
- Migrated tasks get a `🔄` suffix so the frontend renders an amber "延期" badge — no raw emoji visible to the user. Double-stacking is prevented.

**Merge when target exists**: if today's journal already exists, incoming migrated tasks are merged into its `# 当日日程` section instead of bulk-appended. When an incoming top-level task's normalized text (with `🔄` stripped) matches an existing top-level task, its descendants are appended under the existing root — e.g. a rolled-over `数学 🔄` merges its subtasks under an already-present `数学` rather than creating a duplicate. Unmatched top-level tasks (and leaf roots that would self-nest) are appended at the end of the section as new roots. Indentation is preserved as-is.

When today's journal doesn't exist yet, the rollover **fetches the Obsidian template** from `Templates/Diary_Template.md` on GitHub (path configurable via `DIARY_TEMPLATE_PATH`). It replaces `{{date}}` / `{{DATE:YYYY-MM-DD}}` with the target date and injects undone tasks at `%%TODO_PLACEHOLDER%%`. If the placeholder isn't found, tasks are appended after `## 当日日程`. If the template fetch fails, a built-in fallback template is used — the script never crashes on a missing template file.

This tree-based approach eliminates the orphan-subtask bug (where old line-by-line filtering could split children from their parent, creating orphaned indented items on the target day).

**Real-time UI updates**: all mutations use optimistic updates — the UI applies changes immediately from the server response (or locally-computed content), avoiding the GitHub API's eventual-consistency delay. Patch appends, task toggles, task/subtask additions, and daily notes all update instantly without a re-fetch.

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in Vercel → root directory = `inspirations-farm-app`
3. Add environment variables: `GITHUB_PAT`, `REPO_OWNER`, `REPO_NAME`, `APP_PIN`, `CRON_SECRET`
4. Deploy → your custom domain serves the PWA over HTTPS
5. Verify Cron Job is active in Vercel Dashboard → Cron Jobs

## Changelog

See [docs/DEVLOG.md](docs/DEVLOG.md) for the full development log.

### v1.0.0 (2026-07-05)

**Audit & robustness**
- YAML `status` updates moved from regex to structured `gray-matter` (with `JSON_SCHEMA` so date-like fields such as `create` stay strings — no timezone corruption).
- `parseInspirationPatches` preserves multi-line patch content (continuation lines were previously dropped).
- `calcIndent` uses `Math.floor` (a stray 1-space indent no longer counts as a level); `parseTasks` accepts `-`/`*`/`+` task-list markers.
- `syncIdeasState` runs concurrently via `Promise.allSettled` (was sequential — risked Vercel timeouts).
- `[-+*]` task-marker support made consistent across `cascade.ts`, `rollover.ts`, `insertSubtaskLine` (bullet preserved on toggle/rebuild).
- Daily journals normalised to LF on read — CRLF files (Obsidian on Windows) no longer drop tasks/notes silently.

**Architecture**
- `github.ts` split by SRP into `github-client.ts` (network) + `markdown-utils.ts` (markdown) + `github.ts` (business service). Public API unchanged.
- Section insertion/parsing rewritten on mdast AST — code-block- and frontmatter-safe; byte-for-byte preservation (no full re-serialize).

**Consistency**
- `modifyDailyJournal` wraps daily read-modify-write in 409-retry + a pre-read pause, fixing rapid-successive-write 409s and the silent data-loss from GitHub's eventual consistency.
