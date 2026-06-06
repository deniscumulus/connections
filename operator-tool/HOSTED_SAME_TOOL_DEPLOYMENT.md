# Hosted Deployment: Same Tool As Local

This document explains how to move the current local operator tool to a server so it is available to the team.

This version does **not** add browser automation. It hosts the same current tool:

- create runs
- track checklist
- store captured IDs
- generate HFCM snippets
- generate Yamix fields
- protect access with a simple username/password

Important: this deployment makes the current tool available to everyone, but it is still not the final desired automation. The final desired automation is described in:

```text
FINAL_WORKFLOW_SPEC.md
```

In the final version, the operator fills the first form and clicks `Create Run`; the system then performs the setup.

## Recommended Server

Use a small VPS/cloud server.

Minimum:

- Ubuntu LTS
- 1 vCPU
- 1 GB RAM
- 10 GB disk
- Docker + Docker Compose

Recommended:

- 2 vCPU
- 2 GB RAM
- daily server snapshots/backups

## DNS

Create a subdomain, for example:

```text
setup.cumuluseo.com
```

Point it to the VPS public IP.

## Files To Upload

Upload the whole folder:

```text
operator-tool/
```

Required files:

```text
Dockerfile
docker-compose.yml
.env.example
server.mjs
package.json
public/
data/
```

## Server Setup

On the server:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

Copy the tool to the server, for example:

```bash
/opt/portfolio-setup-operator
```

Create the environment file:

```bash
cd /opt/portfolio-setup-operator
cp .env.example .env
nano .env
```

Set:

```text
BASIC_AUTH_USER=<company-username>
BASIC_AUTH_PASSWORD=<strong-password>
```

Do not commit `.env`.

## Start

```bash
cd /opt/portfolio-setup-operator
docker compose up -d --build
```

Check:

```bash
docker compose ps
docker compose logs -f
```

Local server check:

```bash
curl http://127.0.0.1:4173/healthz
```

## HTTPS

Put Caddy or Nginx in front of the app.

### Simple Caddy Example

Install Caddy, then create:

```text
/etc/caddy/Caddyfile
```

Example:

```text
setup.cumuluseo.com {
  reverse_proxy 127.0.0.1:4173
}
```

Restart:

```bash
sudo systemctl restart caddy
```

Caddy will issue HTTPS certificates automatically if DNS is pointed correctly.

## Access

Open:

```text
https://setup.cumuluseo.com
```

Browser will ask for username/password from `.env`.

## Data Persistence

Runs are stored in:

```text
operator-tool/data/runs.json
```

In Docker this folder is mounted as:

```text
./data:/app/data
```

Back this folder up.

## Updating The App

Upload changed files, then:

```bash
cd /opt/portfolio-setup-operator
docker compose up -d --build
```

## What This Version Is Good For

Good for:

- shared team access
- central run tracking
- generated snippets and Yamix fields
- consistent workflow
- simple deployment

Not yet included:

- automatic GA4 clicking
- automatic GSC property creation
- automatic ManageWP/HFCM clicking
- automatic SE Ranking creation
- automatic Yamix creation

Those require the later browser worker version.

## Security Notes

- Use HTTPS.
- Use a strong basic auth password.
- Do not put real passwords in `.env.example`.
- Keep `.env` on the server only.
- Back up `data/runs.json`.
- Do not write ManageWP/Yamix/SE Ranking/Google passwords into run notes.
