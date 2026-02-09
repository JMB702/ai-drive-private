#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as a non-root user with sudo access."
  exit 1
fi

echo "[1/6] Installing Docker and Compose..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
sudo usermod -aG docker "$USER" || true

echo "[2/6] Ensuring project checkout..."
if [[ ! -d "$HOME/ai-drive" ]]; then
  echo "Expected repo at $HOME/ai-drive. Clone it before continuing."
  exit 1
fi
cd "$HOME/ai-drive"

echo "[3/6] Ensuring production env..."
mkdir -p deploy
if [[ ! -f deploy/.env.production ]]; then
  cp deploy/.env.production.example deploy/.env.production
  echo "Created deploy/.env.production from example."
  echo "Fill provider keys and APP_ACCESS_USERNAME/APP_ACCESS_PASSWORD, then re-run."
  exit 1
fi

echo "[4/6] Building and starting container..."
docker compose -f deploy/docker-compose.always-on.yml up -d --build

echo "[5/6] Waiting for health..."
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "[6/6] Final checks..."
docker compose -f deploy/docker-compose.always-on.yml ps
curl -sS -I http://127.0.0.1:3000/ | sed -n '1,8p'
curl -sS http://127.0.0.1:3000/api/health
echo
echo "Bootstrap complete."
echo "If this is first run, log out and back in for docker-group permissions."

