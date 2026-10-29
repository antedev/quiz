# Raspberry Pi 5 Deployment Guide (`quiz.ante.pub`)

This document is written specifically for an AI agent (or human operator) running on the **Raspberry Pi 5** to deploy **Livslinjen / GeoGuesser Quiz** and expose it at **`https://quiz.ante.pub`** via **Cloudflare Tunnel (`cloudflared`)** and **Docker**.

---

## 1. Architecture Overview (What You Are Deploying)

- **Application**: Client-side React 19 + TypeScript + Leaflet SPA (`livslinjen-quiz`).
- **Backend requirements**: **None.** There is no runtime database or Node server needed in production. All 7,829 historical & contemporary people (`public/data/people.json`, ~8 MB) and pre-sanitized Wikipedia summaries (`public/data/wiki_summaries.json`, ~11 MB) are static JSON files bundled into the production build and served with Gzip compression.
- **Container Setup**: A multi-stage `Dockerfile` (ARM64 native compatible via `node:22-alpine` $\to$ `nginx:alpine`) builds the Vite bundle and serves it on port `80` inside the container, mapped to `127.0.0.1:8088` on the host (adjustable in `docker-compose.yml`).
- **Do NOT run `npm run data` on the RPi5**: The Wikidata/Wikipedia data-fetching pipeline is already pre-built and committed to git in `public/data/`.

---

## 2. Step-by-Step Instructions for the RPi5 Agent

### Step 1: Verify Existing Environment & Port Allocation
Before starting the container, inspect the RPi5's current Docker containers and `cloudflared` setup:
```bash
# 1. Check running containers and used ports
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"

# 2. Check if port 8088 is free (if not, pick an available port like 8089 and update docker-compose.yml)
ss -tulpn | grep 8088 || echo "Port 8088 is free"
```

### Step 2: Build and Start the Docker Container
From the repository root:
```bash
docker compose up -d --build
```
Verify the container is healthy and serving Gzipped responses locally:
```bash
curl -I http://127.0.0.1:8088
curl -I -H "Accept-Encoding: gzip" http://127.0.0.1:8088/data/people.json
```
*(You should see `HTTP/1.1 200 OK` and `Content-Encoding: gzip`).*

---

### Step 3: Connect `quiz.ante.pub` via `cloudflared`

Check how `cloudflared` is currently running on the Raspberry Pi 5:
```bash
# Check if cloudflared runs as a systemd service or a Docker container
systemctl status cloudflared 2>/dev/null || docker ps | grep cloudflared
```

#### Case A: Local `cloudflared` config file (`/etc/cloudflared/config.yml` or `~/.cloudflared/config.yml`)
1. Locate the active config file (`ps aux | grep cloudflared` or inspect `/etc/cloudflared/config.yml`).
2. Add the ingress rule for `quiz.ante.pub` **above** the catch-all `- service: http_status:404` rule:
   ```yaml
   ingress:
     - hostname: quiz.ante.pub
       service: http://127.0.0.1:8088
     # ... existing rules ...
     - service: http_status:404
   ```
   *(Note: If `cloudflared` is running inside another Docker container on a shared Docker network instead of host networking, either attach `livslinjen-quiz` to that Docker network and point to `http://livslinjen-quiz:80`, or use `http://host.docker.internal:8088`).*
3. Route the DNS record in Cloudflare for the tunnel:
   ```bash
   cloudflared tunnel route dns <TUNNEL_NAME_OR_ID> quiz.ante.pub
   ```
4. Restart `cloudflared`:
   ```bash
   sudo systemctl restart cloudflared
   ```

#### Case B: Remotely Managed Tunnel (Cloudflare Zero Trust Dashboard / Token-based)
If `cloudflared` runs with `tunnel run --token ...` (no local `ingress:` block):
- If the Cloudflare API token / CLI is available, add the public hostname route via API/CLI, OR instruct the user:
  - In **Cloudflare Zero Trust $\to$ Networks $\to$ Tunnels $\to$ Public Hostname**:
  - Add Public Hostname: `quiz.ante.pub` $\to$ Service: `HTTP://localhost:8088` (or `http://livslinjen-quiz:80` if on the same Docker network).

---

## 3. Updating the App in the Future

Whenever new code or dataset updates are pushed to GitHub, updating on the RPi5 is a single command:
```bash
git pull && docker compose up -d --build
```
