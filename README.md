# Inspirations Farm 🌱

A mobile-first PWA personal inspiration management system. GitHub-backed headless CMS, installable on your phone home screen.

**Live**: [todo.alanevergarden.xyz](https://todo.alanevergarden.xyz)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| UI | React 19 + Tailwind CSS v4 |
| Components | shadcn/ui (new-york) |
| Icons | lucide-react |
| Markdown | gray-matter (frontmatter parsing) |
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
- **🔗 Inspiration → Task Linking** — push inspirations to today's journal as `[[timestamp|title]]` wiki-links
- **✅ Cascade Archive** — completing a linked task auto-archives the inspiration
- **⏳ Relative Time** — Beijing-timezone-aware "X小时前" labels
- **🌳 Nested Tasks** — markdown indent-parsed tree with parent-child state sync
- **🔄 Daily Rollover** — cron job at Beijing 00:01 migrates undone tasks from yesterday to today (with dry-run + time-machine modes)
- **📝 Inspiration Patches** — append timestamped follow-up notes to inspirations via `## 追加记录` markdown section
- **📄 Rich Markdown Rendering** — `react-markdown` + `remark-gfm` + `@tailwindcss/typography`; supports **bold**, [links](url), `code`, tables, task lists
- **📋 Template Support** — `Templates/Diary_Template.md` with `{{DATE:YYYY-MM-DD}}` placeholder
- **📱 PWA** — install to home screen, offline cache, standalone mode
- **📂 Headless CMS** — all data in your private GitHub repo as plain Markdown

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
    │   │   │   ├── github/route.ts       # Inspirations CRUD + archive
    │   │   │   ├── daily/route.ts        # Daily journal + push-to-daily
    │   │   │   └── cron/rollover/route.ts # Rollover endpoint
    │   │   ├── layout.tsx                # PWA meta + SW registration (prod only)
    │   │   ├── page.tsx                  # Auth gate + two-column grid
    │   │   ├── lock-screen.tsx           # PIN unlock
    │   │   ├── inspiration-feed.tsx      # Capture + timeline + push button
    │   │   ├── daily-dashboard.tsx       # Nested tasks + cascade + archive
    │   │   └── manifest.ts               # → /manifest.webmanifest
    │   ├── components/ui/                # shadcn/ui
    │   └── lib/
    │       ├── github.ts                 # GitHub API client + markdown parsing
    │       ├── beijing-time.ts           # Asia/Shanghai date utilities
    │       ├── time.ts                   # Survival duration + Beijing-time parser
    │       ├── cascade.ts               # Nested task toggle cascade
    │       ├── rollover.ts              # Daily undone-task migration
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
| PATCH | `{ path, content }` | Append timestamped patch to `## 追加记录` section |
| PUT | `{ path, sha, status }` or `{ ideaId, status }` | Update status or archive by ideaId |
| DELETE | `{ path, sha }` | Delete inspiration |

### /api/daily

| Method | Body | Description |
|---|---|---|
| GET | `?date=YYYY-MM-DD` | Get daily journal with parsed tasks |
| POST | `{ date }` | Create daily journal |
| POST | `{ ideaId, ideaTitle, date }` | Push inspiration into today's tasks |
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
```

**Rollover behavior**: at Beijing 00:01 each day, the cron job reads **yesterday's** journal, marks undone `- [ ]` tasks as `- [>]` (migrated), and appends fresh `- [ ]` copies into **today's** `# 当日日程` section. The `[rollover]` log prefix emits `[INFO] 正在读取的源文件日期: YYYY-MM-DD, 正在写入的目标文件日期: YYYY-MM-DD` for auditability. Time-machine mode (`targetDate=YYYY-MM-DD`) overrides the source date explicitly while keeping target = source + 1. Safe `setUTCDate(±1)` arithmetic handles month/year boundaries correctly.

**Real-time UI updates**: all mutations use optimistic updates — the UI applies changes immediately from the server response (or locally-computed content), avoiding the GitHub API's eventual-consistency delay. Patch appends, task toggles, task/subtask additions, and daily notes all update instantly without a re-fetch.

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in Vercel → root directory = `inspirations-farm-app`
3. Add environment variables: `GITHUB_PAT`, `REPO_OWNER`, `REPO_NAME`, `APP_PIN`, `CRON_SECRET`
4. Deploy → your custom domain serves the PWA over HTTPS
5. Verify Cron Job is active in Vercel Dashboard → Cron Jobs
