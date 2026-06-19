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
- **📅 Daily Dashboard** — journal with nested task checkboxes, parent-child cascade logic
- **🔗 Inspiration → Task Linking** — push inspirations to today's journal as `[[timestamp|title]]` wiki-links
- **✅ Cascade Archive** — completing a linked task auto-archives the inspiration
- **⏳ Survival Timer** — Beijing-time-accurate relative time labels
- **🌳 Nested Tasks** — markdown indent-parsed tree with parent-child state sync
- **🔄 Daily Rollover** — cron job at Beijing 00:01 migrates undone tasks to tomorrow
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
| GET | — | List active inspirations (with `id`, `title`, `content`) |
| POST | `{ content }` | Create inspiration (`Inspirations/YYYY-MM-DD-HHmmss.md`) |
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
| GET | `Authorization: Bearer <CRON_SECRET>` | Migrate undone tasks from today → tomorrow |

## Markdown File Format

**Inspiration** (`Inspirations/2026-06-19-113215.md`):
```yaml
---
type: inspiration
status: active
create: 2026-06-19 11:32:15
---
# User's note content
```

**Daily Journal** (`Journal/Daily/2026-06-19.md`):
```markdown
---
tags:
  - dairy
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

**Rollover behavior**: undone `- [ ]` tasks become `- [>]` (migrated) in today's journal and are appended to tomorrow's `# 当日日程` section.

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in Vercel → root directory = `inspirations-farm-app`
3. Add environment variables: `GITHUB_PAT`, `REPO_OWNER`, `REPO_NAME`, `APP_PIN`, `CRON_SECRET`
4. Deploy → your custom domain serves the PWA over HTTPS
5. Verify Cron Job is active in Vercel Dashboard → Cron Jobs
