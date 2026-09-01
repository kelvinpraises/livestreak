#!/usr/bin/env bash
#
# Manual deploy (bootstrap / no-CI path): build the image locally for linux/amd64,
# push to ghcr.io, then pull + run it on the VPS. The CI workflow
# (.github/workflows/deploy-app.yml) does the same thing on `git push`.
#
# Prereqs:
#   - docker + buildx, logged in to ghcr:  echo $GHCR_PAT | docker login ghcr.io -u <you> --password-stdin
#   - SSH access to the box (PEM at $DEPLOY_KEY, default ~/.ssh/uburu-key-pair.pem)
#
# Usage:  ./deploy.sh           (uses defaults below; override via env vars)
set -euo pipefail

OWNER="${GHCR_OWNER:-kelvinpraises}"
IMAGE="ghcr.io/${OWNER}/livestreak-app:latest"
HOST="${DEPLOY_HOST:-108.130.99.99}"
SSH_USER="${DEPLOY_USER:-ubuntu}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/uburu-key-pair.pem}"
PORT="${APP_PORT:-3000}"

ROOT="$(cd "$(dirname "$0")" && pwd)"   # repo root (this script lives at the root)

echo "→ building $IMAGE (linux/amd64) …"
docker buildx build --platform linux/amd64 \
  -f "$ROOT/Dockerfile" \
  -t "$IMAGE" --push "$ROOT"

echo "→ deploying on $SSH_USER@$HOST …"
ssh -i "$KEY" -o StrictHostKeyChecking=no "$SSH_USER@$HOST" bash -s <<EOF
set -e
docker pull "$IMAGE"
docker network create uburu-network 2>/dev/null || true
docker stop livestreak-app 2>/dev/null || true
docker rm livestreak-app 2>/dev/null || true
docker run -d --name livestreak-app --restart unless-stopped \
  --network uburu-network -p ${PORT}:3000 "$IMAGE"
docker image prune -f
sleep 5
echo "GET / -> \$(curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/ || echo 000)"
docker logs --tail 20 livestreak-app || true
EOF

echo "✓ done — http://$HOST:$PORT"
