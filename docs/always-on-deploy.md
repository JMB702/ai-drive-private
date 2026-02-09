# Always-On Deployment (Laptop Can Be Off)

This runbook deploys AI Drive to a cloud host so it stays online 24/7, with generated assets persisted to disk.

## What this solves
- App remains available even when your local computer is shut down.
- Generated images and previews persist across restarts (mounted `/data` volume).
- Private access is still enforced by your app sign-in gate (`APP_ACCESS_USERNAME` / `APP_ACCESS_PASSWORD`).

## Safety rule for cutover
Do **not** stop your current local/tunnel setup until Step 7 is completed and verified.

## 1) Provision an always-on Linux host
- Any Ubuntu VM works (AWS Lightsail, DigitalOcean, Hetzner, Linode, etc.).
- Recommended minimum: 2 vCPU, 4 GB RAM, 40+ GB disk.

## 2) Install Docker + Compose on the VM
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```
Then reconnect your shell.

Quick path: on Ubuntu you can run:
```bash
chmod +x deploy/bootstrap-ubuntu.sh
./deploy/bootstrap-ubuntu.sh
```
This handles install + compose deploy + health checks.

## 3) Copy project to the VM
```bash
git clone <your-repo-url> ai-drive
cd ai-drive
```

## 4) Create production env file
```bash
cp deploy/.env.production.example deploy/.env.production
```
Set at least:
- `GEMINI_API_KEY` (and any other provider keys you use)
- `APP_ACCESS_USERNAME`
- `APP_ACCESS_PASSWORD` (strong random password)

## 5) Build and start always-on stack
```bash
docker compose -f deploy/docker-compose.always-on.yml up -d --build
```

## 6) Verify health and persistence
```bash
docker compose -f deploy/docker-compose.always-on.yml ps
curl -I http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/api/health
docker volume ls | grep aidrive_data
```
Expected:
- `/` returns redirect to `/sign-in`
- `/api/health` returns `{"ok":true,"service":"web"}`
- volume exists

## 7) Cut over traffic
Point your domain or reverse proxy to the VM (`:3000`) only after Step 6 passes.

At this point, you can safely stop your old local tunnel setup.

## 8) Updates
```bash
git pull
docker compose -f deploy/docker-compose.always-on.yml up -d --build
```

## 9) Backups (recommended)
The durable app data is in Docker volume `aidrive_data`.
Take scheduled volume backups so generated assets/history are recoverable.
