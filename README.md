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
| Backend/CMS | GitHub REST API (Markdown files) |
| Auth | PIN-based lock screen |
| PWA | manifest + service worker (offline support) |
| Deploy | Vercel |

## Features

- **🔐 PIN Lock Screen** — 4-6 digit access code to protect your data
- **📝 Inspiration Pool** — capture fleeting ideas with one tap, stored as timestamped Markdown files
- **✅ Task Dashboard** — daily journal with clickable checkboxes synced to GitHub
- **⏳ Survival Timer** — each inspiration shows how long it's been alive
- **📱 PWA** — install to home screen, works offline, feels like a native app
- **📂 Headless CMS** — all data lives in your private GitHub repo as plain Markdown

## Project Structure

```
Inspirations_Farm/
├── README.md
├── docs/DEVLOG.md                    # Development log
└── inspirations-farm-app/
    ├── public/
    │   ├── icon.svg                  # PWA icon
    │   └── sw.js                     # Service Worker
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   ├── github/route.ts   # Inspirations CRUD (GET/POST/PUT/DELETE)
    │   │   │   └── daily/route.ts    # Daily journal (GET/POST/PUT)
    │   │   ├── layout.tsx            # Root layout + PWA meta + SW registration
    │   │   ├── page.tsx              # Main page (auth gate + two-column grid)
    │   │   ├── lock-screen.tsx       # PIN unlock screen
    │   │   ├── inspiration-feed.tsx  # Inspiration capture + timeline
    │   │   ├── daily-dashboard.tsx   # Daily task manager
    │   │   └── manifest.ts           # PWA manifest → /manifest.webmanifest
    │   ├── components/ui/            # shadcn/ui (button, card, input, textarea)
    │   └── lib/
    │       ├── github.ts             # GitHub API client
    │       ├── auth.ts               # Server-side PIN validation
    │       ├── api.ts                # Client-side fetch wrapper (auto-PIN + 401 handler)
    │       ├── time.ts               # Survival duration calculator
    │       └── utils.ts              # cn() utility
    ├── .env.example                  # Environment template
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
```

### 3. Repository Setup

Your GitHub repo should have these directories (create a `.gitkeep` in each if empty):

```
Inspirations/       # inspiration .md files live here
Journal/Daily/      # daily journal .md files live here
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter your APP_PIN to unlock.

## API Reference

All endpoints require `x-app-pin` header matching `APP_PIN` (unless `APP_PIN` is unset).

### /api/github

| Method | Body | Description |
|---|---|---|
| GET | — | List all active inspirations |
| POST | `{ content }` | Create inspiration (`Inspirations/YYYY-MM-DD-HHmmss.md`) |
| PUT | `{ path, sha, status }` | Update inspiration status |
| DELETE | `{ path, sha }` | Delete inspiration |

### /api/daily

| Method | Body | Description |
|---|---|---|
| GET | `?date=YYYY-MM-DD` | Get daily journal |
| POST | `{ date }` | Create daily journal |
| PUT | `{ path, sha, content }` | Update journal content |

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
```yaml
---
type: daily
date: 2026-06-19
created: 2026-06-19 14:30:00
---
- [ ] Buy groceries
- [x] Call dentist
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Import in Vercel → set root directory to `inspirations-farm-app`
3. Add all four environment variables in Project Settings
4. Deploy — your custom domain will serve the PWA over HTTPS
