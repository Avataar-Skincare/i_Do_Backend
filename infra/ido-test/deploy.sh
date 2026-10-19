#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# /opt/ido/deploy.sh — the ONLY command GitHub Actions can run on ido-test.
#
# Installed by:  cp /opt/ido/src/i_Do_Backend/infra/ido-test/deploy.sh /opt/ido/deploy.sh
#                chmod 750 /opt/ido/deploy.sh
# Called via a forced command in ~ec2-user/.ssh/authorized_keys:
#   restrict,command="/opt/ido/deploy.sh" ssh-ed25519 AAAA... CI DEPLOY KEY ...
# so whatever the CI key asks to run, sshd runs this script instead and puts the
# request in $SSH_ORIGINAL_COMMAND.
#
# Request:  deploy <service> <tag>
#   service: website | backend | lume
#   tag:     image tag pushed by CI — a git SHA, optionally prefixed (e.g. test-1a2b3c4)
#
# Steps: lock → pull image → migrations (backend, lume) → swap container
#        → wait for healthy → otherwise roll back to the previous image.
# Image choice lives in /opt/ido/.env (WEBSITE_IMAGE / BACKEND_IMAGE / LUME_IMAGE),
# which docker-compose.yml reads. Log: /opt/ido/deploy.log
#
# Maintained by: i do platform/infra (contact: Mithilesh)
# ---------------------------------------------------------------------------
set -euo pipefail

cd /opt/ido
REGISTRY=216505943717.dkr.ecr.ap-south-1.amazonaws.com
LOG=/opt/ido/deploy.log
SERVICE="?" TAG="?"
log() { echo "$(date -u +%FT%TZ) [$SERVICE:$TAG] $*" | tee -a "$LOG"; }

# --- 1. Parse and validate the request (never trust the caller) ------------
read -r ACTION SERVICE TAG EXTRA <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [[ "${ACTION:-}" != "deploy" || -z "${SERVICE:-}" || -z "${TAG:-}" || -n "${EXTRA:-}" ]]; then
  echo "usage: deploy <website|backend|lume> <tag>" >&2; exit 2
fi
case "$SERVICE" in
  website) REPO=ido/website-frontend; VAR=WEBSITE_IMAGE; MIGRATE=() ;;
  backend) REPO=ido/website-backend;  VAR=BACKEND_IMAGE; MIGRATE=(npm run migration:run:prod) ;;
  lume)    REPO=ido/app-backend;      VAR=LUME_IMAGE;    MIGRATE=(npm run db:migrate:prod) ;;
  *) echo "unknown service: $SERVICE" >&2; exit 2 ;;
esac
[[ "$TAG" =~ ^([a-z]+-)?[0-9a-f]{7,40}$ ]] || { echo "bad tag: $TAG" >&2; exit 2; }

# --- 2. One deploy at a time across all repos (the 1 GB box can't do two) ---
exec 9>/opt/ido/.deploy.lock
flock -w 900 9 || { echo "another deploy is still running" >&2; exit 3; }

NEW="$REGISTRY/$REPO:$TAG"
touch .env
PREV=$(grep -E "^$VAR=" .env | cut -d= -f2- || true)

set_image() { if grep -qE "^$VAR=" .env; then sed -i "s#^$VAR=.*#$VAR=$1#" .env; else echo "$VAR=$1" >> .env; fi; }
rollback() {
  log "ROLLBACK to ${PREV:-<compose default>}"
  if [[ -n "$PREV" ]]; then set_image "$PREV"; else sed -i "/^$VAR=/d" .env; fi
  docker compose up -d "$SERVICE" >>"$LOG" 2>&1 || true
}

log "start (running: ${PREV:-<compose default>})"

# --- 3. Pull (auth: ECR credential helper + the server's IAM role) ---------
docker pull -q "$NEW" >>"$LOG" 2>&1 || { log "pull FAILED"; exit 1; }
set_image "$NEW"

# --- 4. Migrations with the NEW image, before it takes traffic -------------
if (( ${#MIGRATE[@]} )); then
  log "migrations: ${MIGRATE[*]}"
  if ! docker compose run --rm --no-deps "$SERVICE" "${MIGRATE[@]}" >>"$LOG" 2>&1; then
    log "migrations FAILED"; rollback; exit 1
  fi
fi

# --- 5. Swap the container and wait for its HEALTHCHECK --------------------
docker compose up -d "$SERVICE" >>"$LOG" 2>&1
CID=$(docker compose ps -q "$SERVICE")
STATUS=unknown
for _ in $(seq 1 30); do                       # up to ~150 s
  STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo unknown)
  [[ "$STATUS" == healthy || "$STATUS" == unhealthy ]] && break
  sleep 5
done

if [[ "$STATUS" != healthy ]]; then
  log "not healthy after deploy (status: $STATUS)"; rollback; exit 1
fi

# --- 6. Keep only the running image and the previous one (rollback) --------
docker images --format '{{.Repository}}:{{.Tag}}' "$REGISTRY/$REPO" \
  | grep -vxF -e "$NEW" -e "${PREV:-none}" | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
log "healthy — deployed"
