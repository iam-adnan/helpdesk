# Mindstorm IT Desk — Ticketing System

A dark-themed IT support ticketing system with AI-powered auto-responses and threaded comments.

## Features

- **AI-Powered Tickets** — When a ticket is created, Claude AI provides a one-line quick fix suggestion
- **Threaded Comments** — Each comment on a ticket gets an AI reply in the same thread
- **Status Tracking** — Open → In Progress → Resolved → Closed
- **Priority Levels** — Low, Medium, High, Critical
- **Persistent Storage** — Tickets are saved to disk via a Docker volume
- **Search & Filter** — Find tickets by ID, title, or status

## Quick Start

### 1. Clone & Configure

```bash
cd mindstorm-tickets
cp .env.example .env
```

Edit `.env` and add your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

Get a key at https://console.anthropic.com/

### 2. Build & Run

```bash
docker compose up -d --build
```

That's it! Open **http://your-server-ip** in your browser.

### 3. Manage

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Stop and remove data
docker compose down -v

# Rebuild after changes
docker compose up -d --build
```

## Architecture

```
┌─────────────┐     ┌──────────────┐
│   Nginx     │────▶│  Express API │
│  (port 80)  │/api │  (port 3001) │
│  React SPA  │     │  + AI calls  │
└─────────────┘     └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  tickets.json│
                    │  (volume)    │
                    └──────────────┘
```

- **Frontend**: Vite + React, served by Nginx
- **Backend**: Express.js, calls Anthropic API for AI responses
- **Storage**: JSON file on a Docker volume (persistent across restarts)

## Without Docker (Development)

```bash
# Terminal 1 — Backend
cd backend
npm install
ANTHROPIC_API_KEY=sk-ant-xxx node server.js

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Frontend dev server runs on http://localhost:5173 with API proxy to :3001.
