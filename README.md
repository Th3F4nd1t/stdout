# stdout — Local Print Server

A lightweight, locally-hosted web interface that exposes your CUPS-managed printer through a simple browser UI. Print from anywhere — on your home network **or** remotely via a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/).

---

## Features

- **File upload** — PDF, JPEG, PNG, GIF, WebP, plain text, PostScript (up to 50 MB)
- **Print options** — copies, page size, orientation, color mode, duplex
- **Printer discovery** — automatically lists all CUPS printers; selects the system default
- **Job status** — polls the CUPS job queue and shows live state (queued → processing → completed)
- **Secure** — Helmet headers, per-IP rate limiting, strict file-type validation, sanitised inputs
- **Docker-ready** — single `docker compose up` to run both the server and the cloudflared tunnel
- **Zero cloud dependencies** — all data stays on your machine

---

## Requirements

| Requirement | Notes |
|---|---|
| **CUPS** | Installed and running on the host. `lp` / `lpstat` must be on `PATH`. |
| **Node.js ≥ 20** | For running without Docker. |
| **Docker + Compose v2** | For the containerised setup. |
| **cloudflared** | Optional — only needed for remote access. |

---

## Quick Start (no Docker)

```bash
# 1. Install dependencies
npm install

# 2. Start the server (defaults to port 3000)
npm start

# 3. Open in your browser
open http://localhost:3000
```

Set the `PORT` environment variable to change the port:

```bash
PORT=8080 npm start
```

---

## Docker Setup

```bash
# Build and start the print server
docker compose up --build -d

# Tail logs
docker compose logs -f stdout
```

The server listens on `http://localhost:3000` (bound to `127.0.0.1` only — not exposed directly to the internet).

---

## Remote Access via Cloudflare Tunnel

Cloudflare Tunnel lets you securely reach your print server from anywhere without opening firewall ports.

### One-time tunnel setup

```bash
# Install cloudflared (macOS example — see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/ for other OSes)
brew install cloudflared

# Authenticate with your Cloudflare account
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create stdout

# Route a hostname to the tunnel (replace with your domain)
cloudflared tunnel route dns stdout print.yourdomain.com
```

### Start with Docker Compose

```bash
# Copy the example env file and fill in your tunnel token
cp .env.example .env
# Edit .env and set TUNNEL_TOKEN to the value printed by:
#   cloudflared tunnel token stdout

docker compose up -d
```

Your print server will be reachable at `https://print.yourdomain.com`.

> **Tip:** Protect the tunnel with a [Cloudflare Access policy](https://developers.cloudflare.com/cloudflare-one/policies/access/) so only you can reach it.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/printers` | List available printers and the system default |
| `POST` | `/api/print` | Submit a print job (multipart/form-data) |
| `GET` | `/api/status/:jobId` | Poll the status of a job |
| `GET` | `/health` | Health check — returns `{ "status": "ok" }` |

### `POST /api/print` fields

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | ✓ | The document to print |
| `printer` | string | | Printer name — defaults to system default |
| `copies` | integer | | Number of copies (1–99, default 1) |
| `pageSize` | string | | `Letter`, `Legal`, `A4`, `A5`, `Tabloid` |
| `orientation` | string | | `portrait` \| `landscape` |
| `colorMode` | string | | `color` \| `monochrome` |
| `sides` | string | | `one-sided` \| `two-sided-long-edge` \| `two-sided-short-edge` |

---

## Development

```bash
# Run in watch mode
npm run dev

# Run tests
npm test
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size in megabytes |
| `UPLOAD_DIR` | `<repo>/uploads` | Temporary directory for uploaded files |
| `TUNNEL_TOKEN` | — | Cloudflare Tunnel token (Docker only) |
| `NODE_ENV` | — | Set to `production` in Docker |

---

## License

MIT
