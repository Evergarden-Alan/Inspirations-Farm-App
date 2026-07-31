# Inspirations Farm 🌱

> 🌐 Languages: **English** | [简体中文](README.zh-CN.md)  
> 🏷️ Version: **v1.0.1**

A mobile-first PWA for personal inspiration and task management. GitHub-backed storage, installable on your phone home screen.

**Live Demo**: [todo.alanevergarden.xyz](https://todo.alanevergarden.xyz)

---

## ✨ Features

### 📝 Inspiration Management
- **Quick Capture** — Timestamped ideas with priority (p0-p3) and tags
- **Follow-up Notes** — Append patches to existing inspirations
- **Push to Daily** — Convert inspirations into today's tasks with one tap
- **Auto-Archive** — Completing a linked task auto-archives the source inspiration
- **Smart Filters** — Filter by priority or tags

### 📅 Daily Dashboard
- **Nested Tasks** — Hierarchical todo list with parent-child relationships
- **Cascade Toggle** — Completing a parent completes all children automatically
- **Daily Jottings** — Timestamped notes for quick thoughts
- **Auto Rollover** — Unfinished tasks migrate to the next day at midnight (Beijing time)
- **Rollover Badge** — Migrated tasks show a distinctive amber "延期" badge

### 🎧 Focus Playlists
- **Bilibili Collections** — Add an updating UGC collection URL from the dedicated settings page
- **Distraction-Free Audio** — Play collection audio during a focus session without titles, covers, video, or native media controls
- **Shuffle & History** — Pick collections and episodes uniformly, avoid recent tracks, and navigate actual playback history
- **Session Recovery** — Keep playing when the focus dialog closes and restore the same episode and position after refresh
- **GitHub-Backed Settings** — Persist playlist metadata at `Areas/FocusPlaylists/playlists.json`

### 🔐 Security & Reliability
- **PIN Protection** — 4-6 digit lock screen with auto-lockout on 401
- **Conflict Resolution** — Automatic retry on concurrent edits (HTTP 409)
- **Network Resilience** — Exponential backoff retry for transient failures
- **Input Validation** — Client and server-side content length/tag limits
- **Path Safety** — Protection against path traversal attacks

### 📱 Mobile Experience
- **PWA Support** — Install to home screen, works offline
- **Touch-Optimized** — 44px minimum touch targets, smooth animations
- **Responsive Design** — Adapts from mobile to desktop
- **Loading States** — Clear feedback for all async operations

### 🎨 Rich Content
- **Markdown Support** — Bold, italic, code, links, tables, task lists
- **Math Rendering** — Inline `$E=mc^2$` and block `$$...$$` equations via KaTeX
- **Code-Block Safe** — Headings inside code blocks don't break parsing
- **CRLF Compatible** — Works with files from Windows Obsidian

---

## 🚀 Quick Start

### 1. Prerequisites

- A GitHub account with a private repository
- Node.js 18+ installed locally (for development)

### 2. Repository Setup

Create these directories in your GitHub repo:

```
your-repo/
├── Inspirations/           # Inspiration markdown files
├── Journal/Daily/          # Daily journal files
├── Areas/FocusPlaylists/   # Focus playlist configuration (created on first add)
└── Templates/              # Optional: Diary_Template.md
```

### 3. Local Development

```bash
# Clone and install
git clone <your-fork>
cd inspirations-farm-app
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials (see below)

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Environment Variables

Create `.env.local`:

```env
# GitHub API credentials
GITHUB_PAT=ghp_your_token_here          # Personal Access Token with 'repo' scope
REPO_OWNER=your-username                 # Your GitHub username
REPO_NAME=your-repo-name                 # Repository name

# Security
APP_PIN=123456                           # 4-6 digit PIN (optional, omit to disable auth)
CRON_SECRET=your-random-secret           # Protect rollover endpoint

# Focus audio relay (required for focus playlist playback)
FOCUS_AUDIO_RELAY_BASE_URL=https://media.example.com/focus-audio
FOCUS_AUDIO_RELAY_SIGNING_SECRET=replace-with-the-relay-shared-secret

# Optional customization
DIARY_TEMPLATE_PATH=Templates/Diary_Template.md  # Path to custom template
```

The relay must use the same signing secret, expose HTTPS in production, validate item-scoped short-lived tickets, and stream Bilibili audio with Range support without storing media files. The current production Vercel project slug is `inspirations-farm-app`.

**Getting a GitHub PAT:**
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token with `repo` scope
3. Copy the token to `GITHUB_PAT`

---

## 📖 Usage Guide

### Capturing Inspirations

1. **Quick Add**: Type in the main input, select priority, add tags (comma-separated)
2. **Priority Levels**:
   - `p0` (Red) — Urgent
   - `p1` (Orange) — High
   - `p2` (Blue) — Normal (default)
   - `p3` (Gray) — Low
3. **Tags**: Use commas to separate: `rust, learning, backend`
4. **Push to Daily**: Click the arrow button on any card to add it to today's tasks

### Managing Daily Tasks

1. **Add Task**: Type in "添加任务..." input and press Enter or click +
2. **Add Subtask**: Click the ↳ icon on any task (max 4 levels deep)
3. **Toggle Complete**: Tap the checkbox — parent tasks cascade to children
4. **Rollover**: Uncompleted tasks automatically move to tomorrow at midnight

### Daily Jottings

Quick timestamped notes for thoughts that don't need a full inspiration:
1. Type in the jottings input
2. Press Enter or click ✓
3. Notes appear in chronological order

### Follow-up Notes (Patches)

Add updates to existing inspirations:
1. Click the 📝 icon on any inspiration card
2. Type your follow-up thought
3. Submit — it appends with a timestamp

### Focus Playlist Audio

1. Open **Settings** and add a Bilibili UGC collection URL, for example `https://www.bilibili.com/video/BV1f53B6qEB6/`.
2. Start a focus session. The player randomly selects a configured collection and episode and plays audio only.
3. Use previous, play/pause, and next in the focus dialog. Closing the dialog does not stop playback; ending the focus session does.

This feature targets the desktop web experience. Signed relay URLs stay in memory and are never persisted to GitHub or browser playback state.

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, React 19) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v4 |
| **UI Components** | shadcn/ui (base-nova) + Radix UI primitives |
| **Markdown** | react-markdown + remark-gfm + rehype-katex |
| **Backend** | GitHub REST API (Contents API) |
| **Auth** | PIN-based with timing-safe comparison |
| **Deployment** | Vercel with Cron Jobs |
| **PWA** | Service Worker + Web App Manifest |

---

## 📂 File Format

### Inspiration File

`Inspirations/2026-06-19-113215.md`:

```markdown
---
type: inspiration
status: active
create: 2026-06-19 11:32:15
priority: p2
tags: [rust, learning]
---

# Learn Rust ownership system

Deep dive into borrowing, lifetimes, and memory safety.

Math example: $E = mc^2$

## 追加记录

- **2026-06-20 14:30** Started reading the Rust book chapter 4
- **2026-06-21 09:15** Completed exercises, feel more confident now
```

### Daily Journal

`Journal/Daily/2026-06-19.md`:

```markdown
---
tags:
  - diary
date: 2026-06-19
---
# 近期计划

Long-term goals go here...

---
# 当日日程

- [ ] Buy groceries
- [ ] [[2026-06-19-113215|Learn Rust]]
    - [ ] Read chapter 4
    - [ ] Do exercises
- [x] Morning workout

---
# 本日总结

## 今日杂记

- **14:30** Had a great idea for the new feature
- **18:00** Finished the Rust chapter, making good progress
```

---

## 🤖 Daily Rollover

Every day at 00:01 (Beijing time), a cron job processes yesterday's tasks:

1. **Parse Task Tree** — Builds parent-child relationships from indentation
2. **Split by Status**:
   - Completed subtrees stay in yesterday
   - Incomplete tasks move to today with `🔄` marker
   - Partial completion: split done/undone portions
3. **Merge or Create**:
   - If today exists: merge tasks (dedup by normalized text)
   - If new day: fetch template and inject tasks

**Visual Indicator**: Migrated tasks show an amber "延期" badge in the UI.

**Template Support**: Customize `Templates/Diary_Template.md` with:
- `{{date}}` or `{{DATE:YYYY-MM-DD}}` — replaced with target date
- `%%TODO_PLACEHOLDER%%` — where rolled-over tasks inject

---

## 🌐 Deployment

### Deploy to Vercel

1. **Push to GitHub**: Commit this repo to your GitHub account
2. **Import to Vercel**:
   - New Project → Import your repo
   - Root Directory: `inspirations-farm-app`
3. **Environment Variables**: Add all variables from `.env.local`
4. **Deploy**: Vercel builds and deploys automatically
5. **Verify Cron**: Check Vercel Dashboard → Cron Jobs for the rollover schedule

### Custom Domain (Optional)

In Vercel project settings → Domains:
- Add your domain (e.g., `todo.yourdomain.com`)
- Configure DNS as instructed
- SSL certificate auto-provisions

---

## 🔌 API Reference

All endpoints require `x-app-pin` header (unless `APP_PIN` is unset).

### Inspirations: `GET /api/github`

List all active inspirations with content and patches.

**Response:**
```json
{
  "ok": true,
  "items": [
    {
      "id": "2026-06-19-113215",
      "sha": "abc123...",
      "title": "Learn Rust",
      "content": "# Learn Rust\n\nDeep dive...",
      "patches": [...],
      "priority": "p2",
      "tags": ["rust", "learning"],
      "create": "2026-06-19 11:32:15"
    }
  ]
}
```

### Create Inspiration: `POST /api/github`

**Body:**
```json
{
  "content": "# My idea\n\nDetails here...",
  "priority": "p2",
  "tags": ["tag1", "tag2"]
}
```

### Push to Daily: `POST /api/daily`

**Body:**
```json
{
  "ideaId": "2026-06-19-113215",
  "ideaTitle": "Learn Rust",
  "date": "2026-06-20"
}
```

**Response:** `409` if the inspiration is already in today's tasks (deduplication).

### Daily Rollover: `GET /api/cron/rollover`

**Auth:** `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`

**Query Parameters:**
- `dryRun=true` — Preview changes without writing to GitHub
- `targetDate=YYYY-MM-DD` — Rollover from this date (for testing/backfill)

**Example:**
```bash
# Dry run (safe preview)
curl "https://your-app.vercel.app/api/cron/rollover?secret=YOUR_SECRET&dryRun=true"

# Backfill a specific date
curl "https://your-app.vercel.app/api/cron/rollover?secret=YOUR_SECRET&targetDate=2026-06-15"
```

---

## 🛠️ Development

### Project Structure

```
inspirations-farm-app/
├── src/
│   ├── app/
│   │   ├── api/              # API routes
│   │   ├── layout.tsx        # Root layout with PWA setup
│   │   ├── page.tsx          # Server entry point
│   │   ├── home.tsx          # Client shell with PIN lock
│   │   ├── inspiration-feed.tsx
│   │   ├── daily-dashboard.tsx
│   │   └── jottings-card.tsx
│   ├── lib/
│   │   ├── github-client.ts  # Low-level GitHub API
│   │   ├── markdown-utils.ts # Markdown parsing (AST-based)
│   │   ├── github.ts         # High-level data service
│   │   ├── rollover.ts       # Daily task migration logic
│   │   ├── cascade.ts        # Nested task toggle
│   │   └── auth.ts           # PIN validation
│   └── components/ui/        # shadcn/ui components
├── public/
│   ├── icon.svg              # PWA icon
│   └── sw.js                 # Service worker
└── vercel.json               # Cron schedule
```

### Build Commands

```bash
npm run dev        # Development server (localhost:3000)
npm run build      # Production build
npm run start      # Serve production build
npm run lint       # ESLint check
```

### Code Architecture

The codebase follows single-responsibility principles:

- **`github-client.ts`**: Pure HTTP layer — fetch, auth, retry, base64
- **`markdown-utils.ts`**: Pure Markdown parsing — AST-based, no network
- **`github.ts`**: Business logic — orchestrates client + markdown utils
- **API routes**: Thin controllers — validation, call lib functions, return JSON
- **Components**: Presentation + local state — call API routes, render UI

**Markdown Safety**: All section insertions use `mdast` AST parsing to locate headings. Code blocks and YAML frontmatter are separate node types, preventing false matches and file corruption.

---

## 🐛 Troubleshooting

### "Unauthorized" / Lock Screen Won't Unlock

- Check `APP_PIN` in `.env.local` matches what you're entering
- Verify `x-app-pin` header is sent (check browser DevTools → Network)
- In production: ensure Vercel environment variables are set

### Tasks Not Rolling Over

- Check Vercel Dashboard → Cron Jobs → verify "daily rollover" is active
- Test manually: `GET /api/cron/rollover?secret=YOUR_SECRET&dryRun=true`
- Check Vercel Function Logs for errors

### Inspirations Not Saving

- Verify `GITHUB_PAT` has `repo` scope
- Check repo directories exist: `Inspirations/`, `Journal/Daily/`
- Verify `REPO_OWNER` and `REPO_NAME` are correct
- Check Network tab for API errors

### Math Not Rendering

- Ensure KaTeX CSS is imported in `globals.css`
- Use `$...$` for inline, `$$...$$` for block equations
- Check console for KaTeX errors (invalid LaTeX syntax)

---

## 📝 Changelog

### v1.0.1 (2026-07-05)

**Security & Reliability**
- XSS protection with rehype-sanitize
- Path traversal prevention in file operations
- Network retry with exponential backoff
- Input validation (10k chars content, 10 tags max)
- Memory leak fixes (timer cleanup on unmount)
- Race condition fix (await sequential deletes)

**Robustness**
- HTTP 409 conflict resolution with retry
- GitHub eventual consistency handling (exponential backoff)
- Concurrency limiting (10 parallel requests max)
- Error boundaries for graceful degradation
- Proper HTTP status codes (404 vs 500)

**Accessibility**
- ARIA labels on interactive buttons
- Touch targets ≥44px
- Screen reader support for toasts

**Code Quality**
- Split monolithic `github.ts` into client/utils/service layers
- AST-based markdown parsing (code-block safe)
- CRLF normalization for cross-platform compatibility

### v1.0.0 (Initial Release)

Core features: inspiration capture, daily tasks, rollover, PWA, GitHub backend.

---

## 📄 License

MIT License - see LICENSE file for details.

---

## 🙏 Credits

Built with:
- [Next.js](https://nextjs.org/) by Vercel
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Radix UI](https://www.radix-ui.com/)
- [react-markdown](https://github.com/remarkjs/react-markdown)
- [KaTeX](https://katex.org/)
- [Lucide Icons](https://lucide.dev/)

---

**Questions or Issues?** Open an issue on GitHub or check the troubleshooting section above.
