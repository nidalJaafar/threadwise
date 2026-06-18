# ThreadWise

ThreadWise is a local-first, read-only Gmail conversation viewer that organizes imported email into clients, threads, chat-style views, ignored/noise buckets, and optional AI summaries.

It is built with Next.js App Router, tRPC, Auth.js, Prisma, SQLite, and Tailwind CSS.

## Features

- Read-only Gmail sync using `https://www.googleapis.com/auth/gmail.readonly`
- Client-oriented thread organization
- Unknown/Unsorted queue with domain repair tools
- Ignore rules for noisy email and domain-only notifications
- Chat-style thread viewer with metadata sidebar
- Optional OpenAI thread summaries, actions, decisions, risks, and entities
- Date-based thread view with calendar picker
- Local browser/PWA notifications for newly synced emails
- Installable PWA
- Local production launcher scripts and optional `systemd --user` service

## Requirements

- Node.js 20+
- npm
- A Google OAuth app
- Optional: OpenAI API key for AI summaries/classification

## Setup

Install dependencies:

```bash
npm install
```

Create local environment config:

```bash
cp .env.example .env
```

Fill in `.env`:

```env
AUTH_SECRET="..."
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
DATABASE_URL="file:./db.sqlite"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5.4-mini"
```

Generate an Auth.js secret if needed:

```bash
npx auth secret
```

Initialize the local SQLite schema:

```bash
npm run db:push
```

## Google OAuth

Configure your Google OAuth client with callback URLs for the ports you use.

For local development:

```text
http://localhost:3000/api/auth/callback/google
```

For the production-style local launcher in this repo:

```text
http://localhost:30000/api/auth/callback/google
```

ThreadWise only requests Gmail read-only access. It does not send, delete, archive, label, or mark emails read/unread.

## Development

Run the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Production-Style Local Run

Build once:

```bash
npm run build
```

Start with Next directly:

```bash
npm run start
```

Or use the ThreadWise launcher, which defaults to port `30000`:

```bash
npm run threadwise:start
```

Stop it:

```bash
npm run threadwise:stop
```

Override the port if needed:

```bash
PORT=30001 npm run threadwise:start
```

## Optional Local Service

Install a `systemd --user` service that runs the production server on port `30000`:

```bash
npm run threadwise:install-service
```

Manage it with:

```bash
systemctl --user status threadwise.service
systemctl --user restart threadwise.service
journalctl --user -u threadwise.service -f
```

After code changes, rebuild and restart:

```bash
npm run build
systemctl --user restart threadwise.service
```

## PWA Install

Build and run the app, then open:

```text
http://localhost:30000
```

Use the browser install button or menu item to install ThreadWise as a PWA.

The installed PWA still needs the local ThreadWise server running for sync, auth, and database access.

## Notifications

ThreadWise can request browser notification access and notify for every newly synced email, including ignored/noise emails.

Notifications use the registered service worker when available and fall back to page notifications.

Current limitation: notifications work while the app/browser/PWA is open or running. Fully closed-app background Gmail polling is intentionally out of scope for the PWA version.

## Useful Commands

```bash
npm run typecheck
npm run lint
npm run build
npm run db:push
npm run db:studio
```

## Data And Privacy

- Gmail data is imported into local SQLite.
- `.env`, SQLite DB files, logs, PIDs, and generated Prisma client output are ignored by Git.
- AI thread analysis is opt-in per thread.
- Client classification prefers deterministic domain/manual rules before AI.

## Repository Notes

The Prisma client is generated into `generated/prisma` and intentionally ignored. Run `npm install` or `npx prisma generate` to regenerate it locally.
