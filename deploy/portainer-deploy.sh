#!/usr/bin/env bash
# Roll the cloudbase-platform Portainer stack to images pinned to one commit, verify, roll back on failure.
#
# Reuses the documented manual process (update the existing stack) but changes only the two CloudBase
# image lines. Stack env vars, volumes, networks and every other line are sent back unchanged.
# PullImage is off: images are pinned by digest, so a new one is pulled because it is missing locally,
# and Portainer does not force-recreate (restart) the unchanged Postgres container.
#
# Required env:
#   PORTAINER_URL, PORTAINER_API_KEY, PORTAINER_ENDPOINT_ID, PORTAINER_STACK_ID
#   DEPLOY_SHA            full commit SHA being deployed
#   BACKEND_IMAGE         e.g. minipcer/cloudbase-backend:<sha>@sha256:<digest>
#   FRONTEND_IMAGE        e.g. minipcer/cloudbase-frontend:<sha>@sha256:<digest>
#   HEALTH_API_URL        e.g. https://api.cloudbase.website
#   HEALTH_WEB_URL        e.g. https://www.cloudbase.website
#   GITHUB_TOKEN, GITHUB_REPOSITORY   (used to refuse rolling back to an older commit)
# Optional env:
#   DEPLOY_TIMEOUT_SECONDS (default 300)
#   DEPLOY_RECONCILE_SECONDS (default 900): how long to wait for an unreachable Portainer before reporting unknown state
#   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (if Portainer is put behind Cloudflare Access)
#
# Never prints stack env values or credentials: Portainer stack responses contain the env, so they are
# only ever parsed with jq, never echoed.
set -euo pipefail

: "${PORTAINER_URL:?}" "${PORTAINER_API_KEY:?}" "${PORTAINER_ENDPOINT_ID:?}" "${PORTAINER_STACK_ID:?}"
: "${DEPLOY_SHA:?}" "${BACKEND_IMAGE:?}" "${FRONTEND_IMAGE:?}" "${HEALTH_API_URL:?}" "${HEALTH_WEB_URL:?}"
TIMEOUT="${DEPLOY_TIMEOUT_SECONDS:-300}"
# A rollout (and a rollback) must stay healthy for 30s, so a shorter timeout could never succeed.
(( TIMEOUT > 30 )) || { echo "::error::DEPLOY_TIMEOUT_SECONDS must be greater than 30"; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

log() { echo "[deploy] $*"; }
fail() { echo "::error::$*"; exit 1; }

portainer() {
  local extra=()
  if [[ -n "${CF_ACCESS_CLIENT_ID:-}" ]]; then
    extra+=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET:?}")
  fi
  curl -sS --fail --max-time 180 -H "X-API-Key: ${PORTAINER_API_KEY}" "${extra[@]}" "$@"
}

# --- read the live stack (kept in a private temp dir, never printed) ---------------------------------
portainer "${PORTAINER_URL}/api/stacks/${PORTAINER_STACK_ID}" > "$WORK/stack.json"
portainer "${PORTAINER_URL}/api/stacks/${PORTAINER_STACK_ID}/file" | jq -r '.StackFileContent' > "$WORK/previous.yml"
STACK_NAME="$(jq -r '.Name' "$WORK/stack.json")"
[[ "$(jq -r '.EndpointId' "$WORK/stack.json")" == "$PORTAINER_ENDPOINT_ID" ]] || fail "stack endpoint mismatch"
log "stack ${PORTAINER_STACK_ID} (${STACK_NAME}), $(jq '.Env | length' "$WORK/stack.json") env vars preserved"

current_image() { grep -oE "image:[[:space:]]*[^[:space:]]*cloudbase-$1[^[:space:]]*" "$WORK/previous.yml" | head -1 | sed -E 's/image:[[:space:]]*//'; }
PREV_BACKEND="$(current_image backend)"
PREV_FRONTEND="$(current_image frontend)"
[[ -n "$PREV_BACKEND" && -n "$PREV_FRONTEND" ]] || fail "could not find the cloudbase-backend/frontend image lines in the live stack"
log "previous backend:  ${PREV_BACKEND}"
log "previous frontend: ${PREV_FRONTEND}"

# --- never let an older run replace a newer release ---------------------------------------------------
DEPLOYED_SHA="$(sed -nE 's/.*:([0-9a-f]{40})(@.*)?$/\1/p' <<<"$PREV_BACKEND")"
if [[ -n "$DEPLOYED_SHA" && -n "${GITHUB_TOKEN:-}" ]]; then
  if [[ "$DEPLOYED_SHA" == "$DEPLOY_SHA" ]]; then
    log "commit ${DEPLOY_SHA} is already deployed; verifying only"
  else
    STATUS="$(curl -sS --fail --max-time 60 -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" \
      "${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY}/compare/${DEPLOYED_SHA}...${DEPLOY_SHA}" | jq -r '.status')"
    case "$STATUS" in
      ahead) log "commit is newer than deployed ${DEPLOYED_SHA:0:7}" ;;
      behind|identical) log "::notice::deployed ${DEPLOYED_SHA:0:7} is newer than or equal to ${DEPLOY_SHA:0:7}; skipping"; echo "skipped=true" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0 ;;
      *) fail "deployed ${DEPLOYED_SHA:0:7} and ${DEPLOY_SHA:0:7} are '${STATUS}'; refusing to deploy automatically" ;;
    esac
  fi
fi

# --- build the new stack file: only the two image lines change ----------------------------------------
pin() { sed -E "s#^([[:space:]]*image:[[:space:]]*)[^[:space:]]*cloudbase-$1[^[:space:]]*#\1$2#"; }
pin backend "$BACKEND_IMAGE" < "$WORK/previous.yml" | pin frontend "$FRONTEND_IMAGE" > "$WORK/next.yml"
CHANGED="$(diff "$WORK/previous.yml" "$WORK/next.yml" | grep -c '^>' || true)"
[[ "$CHANGED" -le 2 ]] || fail "unexpected stack file changes (${CHANGED} lines)"

update_stack() {  # $1 = compose file to apply
  jq -n --rawfile f "$1" --slurpfile s "$WORK/stack.json" \
    '{StackFileContent: $f, Env: $s[0].Env, Prune: false, PullImage: false}' > "$WORK/body.json"
  local code
  code="$(portainer -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
    --data-binary @"$WORK/body.json" "${PORTAINER_URL}/api/stacks/${PORTAINER_STACK_ID}?endpointId=${PORTAINER_ENDPOINT_ID}")" || code="curl-failed"
  rm -f "$WORK/body.json"
  [[ "$code" == "200" ]] || { echo "::warning::stack update returned ${code}"; return 1; }
}

container() {  # $1 = service name -> "<image>|<state>|<restartCount>|<health>"
  portainer "${PORTAINER_URL}/api/endpoints/${PORTAINER_ENDPOINT_ID}/docker/containers/cloudbase-$1/json" 2>/dev/null \
    | jq -r '[.Config.Image, .State.Status, (.RestartCount|tostring), (.State.Health.Status // "none")] | join("|")' \
    || echo "missing|||"
}

field() { cut -d'|' -f"$2" <<<"$1"; }  # field <container-line> <n>: 1=image 2=state 3=restarts 4=health

wait_healthy() {  # $1 = expected backend image, $2 = expected frontend image, $3 = expect revision (or "")
  local deadline=$((SECONDS + TIMEOUT)) be fe pg ok_since="" restarts="" now_restarts
  while (( SECONDS < deadline )); do
    be="$(container backend)"; fe="$(container frontend)"; pg="$(container postgres)"
    if [[ "$(field "$be" 1)" == "$1" && "$(field "$fe" 1)" == "$2" \
          && "$(field "$be" 2)" == running && "$(field "$fe" 2)" == running \
          && "$(field "$pg" 2)" == running && "$(field "$pg" 4)" == healthy ]] \
       && [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${HEALTH_API_URL}/api/public/app-config")" == 200 ]] \
       && [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${HEALTH_API_URL}/api/auth/me")" == 401 ]] \
       && [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${HEALTH_WEB_URL}/")" == 200 ]]; then
      if [[ -n "$3" ]]; then
        local rev
        rev="$(portainer "${PORTAINER_URL}/api/endpoints/${PORTAINER_ENDPOINT_ID}/docker/containers/cloudbase-backend/json" \
          | jq -r '.Config.Labels["org.opencontainers.image.revision"] // ""')"
        [[ "$rev" == "$3" ]] || { log "backend revision label '${rev}' != ${3}"; sleep 10; continue; }
      fi
      # Require 30s of stable running with no restarts: a crash loop can look "running" between samples.
      now_restarts="$(field "$be" 3)/$(field "$fe" 3)"
      if [[ -z "$ok_since" || "$now_restarts" != "$restarts" ]]; then
        ok_since=$SECONDS; restarts="$now_restarts"
      elif (( SECONDS - ok_since >= 30 )); then
        log "healthy: backend and frontend running, postgres $(field "$pg" 4), restarts ${restarts}"
        return 0
      fi
    else
      ok_since=""
      [[ "$(field "$be" 1)" == missing ]] && ! reachable && { log "waiting: portainer unreachable"; sleep 10; continue; }
      log "waiting: backend $(field "$be" 2) frontend $(field "$fe" 2) postgres $(field "$pg" 2)/$(field "$pg" 4)"
    fi
    sleep 10
  done
  return 1
}

reachable() { portainer -o /dev/null --max-time 20 "${PORTAINER_URL}/api/stacks/${PORTAINER_STACK_ID}" 2>/dev/null; }

wait_reachable() {  # until Portainer answers again, at most RECONCILE_SECONDS
  local deadline=$((SECONDS + RECONCILE))
  until reachable; do
    (( SECONDS < deadline )) || return 1
    log "portainer unreachable; waiting to reconcile before any rollback"
    sleep 10
  done
}

unknown_state() {
  fail "STATE UNKNOWN: Portainer unreachable for ${RECONCILE}s after the rollout of ${DEPLOY_SHA:0:7}; no blind rollback was attempted. \
Check the running cloudbase-backend/frontend images before acting. New: ${BACKEND_IMAGE##*/} Previous: ${PREV_BACKEND##*/} / ${PREV_FRONTEND##*/}"
}

RECONCILE="${DEPLOY_RECONCILE_SECONDS:-900}"

log "rolling out ${DEPLOY_SHA:0:7}"
if update_stack "$WORK/next.yml" && wait_healthy "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "$DEPLOY_SHA"; then
  log "deployed ${DEPLOY_SHA}"
  echo "skipped=false" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi

# An unreachable control plane is not an unhealthy release: find out what is actually running first.
echo "::error::rollout of ${DEPLOY_SHA:0:7} not confirmed healthy within ${TIMEOUT}s; reconciling live state"
wait_reachable || unknown_state
BE="$(container backend)"; FE="$(container frontend)"
log "live: backend $(field "$BE" 1 | sed 's#.*/##') ($(field "$BE" 2)), frontend $(field "$FE" 1 | sed 's#.*/##') ($(field "$FE" 2))"

if [[ "$(field "$BE" 1)" == "$BACKEND_IMAGE" && "$(field "$FE" 1)" == "$FRONTEND_IMAGE" ]] \
   && wait_healthy "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "$DEPLOY_SHA"; then
  log "::notice::new images are running and healthy after the control plane recovered"
  log "deployed ${DEPLOY_SHA}"
  echo "skipped=false" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi

if [[ "$(field "$BE" 1)" == "$PREV_BACKEND" && "$(field "$FE" 1)" == "$PREV_FRONTEND" ]]; then
  # The rollout never reached the containers. Put the stack file back so it matches what runs.
  if update_stack "$WORK/previous.yml" && wait_healthy "$PREV_BACKEND" "$PREV_FRONTEND" ""; then
    fail "rollout did not apply; production is still on the previous images (${PREV_BACKEND##*/}) and healthy; stack file restored"
  fi
fi

echo "::error::rolling back to the previous images"
if update_stack "$WORK/previous.yml" && wait_healthy "$PREV_BACKEND" "$PREV_FRONTEND" ""; then
  fail "rolled back to previous images (${PREV_BACKEND##*/})"
fi
reachable || unknown_state
fail "ROLLBACK FAILED with Portainer reachable: restore manually with the previous images ${PREV_BACKEND} / ${PREV_FRONTEND}"
