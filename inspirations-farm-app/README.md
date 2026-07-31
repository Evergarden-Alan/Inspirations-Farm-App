# Inspirations Farm

A personal inspiration management dashboard backed by a GitHub-hosted Obsidian vault. The app captures ideas, daily jottings, and daily tasks, then renders them as Markdown in a Next.js dashboard.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui + Base UI React primitives
- GitHub REST API as the flat-file persistence layer
- `react-markdown` with GitHub-Flavored Markdown and KaTeX math rendering

## Features

- Inspiration pool with priority, tags, completion, deletion, and append-only patches
- Daily dashboard with tasks, nested subtasks, rollover markers, and parent-child completion cascade
- Daily jottings timeline
- Focus playlist settings backed by `Areas/FocusPlaylists/playlists.json`
- Distraction-free Bilibili collection audio during desktop focus sessions, with shuffle, history, and refresh recovery
- PIN-gated client shell
- Server-side data loading with dynamic rendering and no-store GitHub fetches
- Markdown rendering with:
  - GitHub-Flavored Markdown via `remark-gfm`
  - Inline math via `$...$`
  - Block math via `$$...$$`
  - KaTeX styling loaded globally from `katex/dist/katex.min.css`

## Markdown Math Support

All `ReactMarkdown` renderers are configured with:

```tsx
remarkPlugins={[remarkGfm, remarkMath]}
rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: "html" }]]}
```

The `output: "html"` option forces KaTeX to emit visual HTML only, avoiding exposed trailing MathML/source text such as `{\displaystyle O(1)}` in compact prose contexts.

Example content:

```markdown
Inline formula: $E = mc^2$

Block formula:

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server from this directory:

```bash
npm run dev
```

Or from the repository root:

```bash
npm --prefix inspirations-farm-app run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Create `inspirations-farm-app/.env.local` with the required values:

```env
GITHUB_PAT=your_github_token
REPO_OWNER=your_github_owner_or_org
REPO_NAME=your_vault_repo_name
APP_PIN=your_pin
FOCUS_AUDIO_RELAY_BASE_URL=https://media.example.com/focus-audio
FOCUS_AUDIO_RELAY_SIGNING_SECRET=replace_with_the_relay_shared_secret
```

Focus playback requires an HTTPS relay in production. The relay must validate item-scoped short-lived signatures, preserve HTTP Range behavior, and stream without storing media files. Configure the same signing secret in the app and relay; never expose or commit it.

> **Important:** The development server writes through the same API routes as production. If `.env.local` points at your real GitHub vault, creating, editing, completing, or deleting items in local dev will update the real repository.

## Common Commands

```bash
npm run dev      # start local development server
npm run build    # create a production build
npm run start    # start the production server
npm run lint     # run ESLint
```

From the repository root, prefix commands with the app directory:

```bash
npm --prefix inspirations-farm-app run build
```

## Project Structure

```text
src/app/page.tsx                Server component shell
src/app/home.tsx                Client shell with PIN lock
src/app/dashboard-content.tsx   Server-side data loading and reconciliation
src/app/daily-dashboard.tsx     Daily tasks UI and Markdown task text rendering
src/app/inspiration-feed.tsx    Inspiration pool and patch rendering
src/app/jottings-card.tsx       Daily jottings Markdown rendering
src/app/focus-audio-controller.tsx Persistent focus-session audio playback
src/app/settings/               Focus playlist settings and relay diagnostics
src/app/globals.css             Tailwind, shadcn, animation, and KaTeX global CSS
src/lib/github.ts               GitHub API client and Markdown parsing helpers
src/lib/focus-playlists.ts      Playlist domain models and Bilibili collection parsing
src/lib/focus-playlist-cache.ts IndexedDB playlist cache and playback state helpers
src/lib/data.ts                 Server-side data layer
src/lib/api.ts                  Client-side API wrapper with PIN header
```

## Verification

After changing Markdown rendering or dependencies, run from the repository root:

```bash
npm --prefix inspirations-farm-app exec -- tsc -p inspirations-farm-app/tsconfig.json --noEmit
npm --prefix inspirations-farm-app run build
```

To manually verify KaTeX rendering, add test Markdown in a safe test repository or a disposable entry:

```markdown
Inline: $O(1)$ and $\frac{a}{b}$

$$
\begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}
$$
```

Confirm the formulas render visually and no raw trailing text such as `{\displaystyle ...}` appears after them.
