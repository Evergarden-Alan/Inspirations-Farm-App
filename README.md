# Inspirations Farm

A full-stack PWA personal inspiration management system. Mobile-first, GitHub-backed headless CMS.

## Tech Stack

| Layer        | Technology                          |
| ------------ | ----------------------------------- |
| Framework    | Next.js 16 (App Router)             |
| Language     | TypeScript                          |
| UI           | React 19 + Tailwind CSS v4          |
| Components   | shadcn/ui (new-york)                |
| Backend/CMS  | GitHub REST API (Markdown files)    |
| Deploy       | Vercel                              |

## Project Structure

```
inspirations-farm-app/
├── src/
│   ├── app/
│   │   ├── api/github/route.ts   # GitHub API proxy (GET + POST)
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Home / test page
│   │   └── test-panel.tsx        # Test panel (client component)
│   ├── components/ui/            # shadcn/ui components
│   └── lib/
│       ├── github.ts             # GitHub API client
│       └── utils.ts              # cn() utility
├── .env.example                  # Environment variables template
└── docs/DEVLOG.md                # Development log
```

## Getting Started

### 1. Clone & Install

```bash
cd inspirations-farm-app
npm install
```

### 2. Environment Variables

Copy the template and fill in your GitHub credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
GITHUB_PAT=ghp_your_personal_access_token
REPO_OWNER=your-github-username
REPO_NAME=your-private-repo
```

> The PAT needs `repo` scope to read/write repository contents.

### 3. Repository Setup

Ensure your target GitHub repo has an `Inspirations/` directory (can be empty, or create a placeholder file like `Inspirations/.gitkeep`).

### 4. Run Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The test page lets you:

- **Create .md** — writes a new markdown file to `Inspirations/` with YAML frontmatter
- **List Files** — fetches the file listing from the `Inspirations/` directory

## API

| Method | Endpoint       | Description                          |
| ------ | -------------- | ------------------------------------ |
| GET    | `/api/github`  | List files in `Inspirations/`        |
| POST   | `/api/github`  | Create a timestamped `.md` file      |
