#!/usr/bin/env bash
# Scenario tests for deploy/portainer-deploy.sh against deploy/test/mock-portainer.js.
# Needs bash, curl, jq, node. Runs in CI on every PR and push.
# Conditions are passed to check() as strings and eval'd there, so single quotes are intended.
# shellcheck disable=SC2016,SC2034
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT=18999
NEW_SHA="$(printf 'b%.0s' {1..40})"
BE_DIGEST="sha256:$(printf '3%.0s' {1..64})"
FE_DIGEST="sha256:$(printf '4%.0s' {1..64})"
OUT="$(mktemp)"
MOCK_PID=""
failures=0
trap '[[ -n "$MOCK_PID" ]] && kill "$MOCK_PID" 2>/dev/null; rm -f "$OUT"' EXIT

start_mock() {  # mode compare
  if [[ -n "$MOCK_PID" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  MODE="$1" COMPARE="$2" OUTAGE_SECONDS="${OUTAGE_SECONDS:-15}" PORT="$PORT" node deploy/test/mock-portainer.js >/dev/null &
  MOCK_PID=$!
  for _ in $(seq 1 50); do curl -s "http://127.0.0.1:${PORT}/_puts" >/dev/null && return; sleep 0.1; done
  echo "mock did not start"; exit 1
}

run_deploy() {  # timeout -> sets RC
  set +e
  PORTAINER_URL="http://127.0.0.1:${PORT}" PORTAINER_API_KEY="${API_KEY:-test-key}" PORTAINER_ENDPOINT_ID=3 PORTAINER_STACK_ID=44 \
  DEPLOY_SHA="$NEW_SHA" \
  BACKEND_IMAGE="minipcer/cloudbase-backend:${NEW_SHA}@${BE_DIGEST}" \
  FRONTEND_IMAGE="minipcer/cloudbase-frontend:${NEW_SHA}@${FE_DIGEST}" \
  HEALTH_API_URL="http://127.0.0.1:${PORT}/health" HEALTH_WEB_URL="http://127.0.0.1:${PORT}/health/web" \
  GITHUB_TOKEN=test GITHUB_REPOSITORY=o/r GITHUB_API_URL="http://127.0.0.1:${PORT}/github" \
  DEPLOY_TIMEOUT_SECONDS="$1" DEPLOY_RECONCILE_SECONDS="${RECONCILE:-60}" GITHUB_OUTPUT=/dev/null \
    bash deploy/portainer-deploy.sh >"$OUT" 2>&1
  RC=$?
  set -e
}

puts() { curl -s "http://127.0.0.1:${PORT}/_puts"; }
check() {  # description, condition (bash expression result 0/1)
  if eval "$2"; then echo "  ok   - $1"; else echo "  FAIL - $1"; failures=$((failures + 1)); sed 's/^/        /' "$OUT"; fi
}
common_checks() {
  check "no secret values in output" '! grep -q "SECRET-" "$OUT"'
  check "every update preserved env, volumes, postgres; prune off; pull off" \
    '[[ "$(puts | jq "all(.envPreserved and .volumesKept and .postgresUntouched and (.prune == false) and (.pull == false))")" == true ]]'
}

echo "1. healthy rollout"
start_mock ok ahead; run_deploy 120
check "exits 0" '[[ $RC -eq 0 ]]'
check "exactly one update" '[[ "$(puts | jq length)" == 1 ]]'
check "pinned to the new digest" '[[ "$(puts | jq -r ".[0].backend")" == "cloudbase-backend:${NEW_SHA}@${BE_DIGEST}" ]]'
common_checks

echo "2. failing health checks roll back"
start_mock broken ahead; run_deploy 45
check "exits non-zero" '[[ $RC -ne 0 ]]'
check "second update restores the previous image" '[[ "$(puts | jq -r ".[1].backend")" == cloudbase-backend:$(printf "a%.0s" {1..40})@sha256:* ]]'
check "reports the rollback" 'grep -q "rolled back to previous images" "$OUT"'
common_checks

echo "3. crash loop (running but restarting) rolls back"
start_mock crashloop ahead; run_deploy 45
check "exits non-zero" '[[ $RC -ne 0 ]]'
check "rolled back" '[[ "$(puts | jq length)" == 2 ]]'
common_checks

echo "4. older commit is skipped"
start_mock ok behind; run_deploy 45
check "exits 0 without updating" '[[ $RC -eq 0 && "$(puts | jq length)" == 0 ]]'
check "says why" 'grep -q "skipping" "$OUT"'

echo "5. diverged history is refused"
start_mock ok diverged; run_deploy 45
check "exits non-zero without updating" '[[ $RC -ne 0 && "$(puts | jq length)" == 0 ]]'

echo "6. wrong API key fails before any change"
start_mock ok ahead; API_KEY=wrong run_deploy 45
check "exits non-zero without updating" '[[ $RC -ne 0 && "$(puts | jq length)" == 0 ]]'

echo "7. tunnel outage: rollout never reached the containers -> reconcile, no blind rollback"
start_mock outage ahead; run_deploy 35
check "exits non-zero" '[[ $RC -ne 0 ]]'
check "reports production unchanged" 'grep -q "rollout did not apply; production is still on the previous images" "$OUT"'
check "stack file restored to the previous images" '[[ "$(puts | jq -r ".[-1].backend")" == cloudbase-backend:$(printf "a%.0s" {1..40})@sha256:* ]]'
check "says portainer was unreachable" 'grep -q "portainer unreachable" "$OUT"'
common_checks

echo "8. outage outlasts the health window but the new release did start -> verified, no rollback"
OUTAGE_SECONDS=45 start_mock outage-applied ahead; run_deploy 35
check "exits 0" '[[ $RC -eq 0 ]]'
check "exactly one update" '[[ "$(puts | jq length)" == 1 ]]'
check "notes recovery" 'grep -q "after the control plane recovered" "$OUT"'

echo "9. portainer never comes back -> unknown state, no blind rollback"
start_mock outage-forever ahead; RECONCILE=20 run_deploy 35
check "exits non-zero" '[[ $RC -ne 0 ]]'
check "reports unknown state" 'grep -q "STATE UNKNOWN" "$OUT"'
check "no rollback update was sent" '[[ "$(curl -s "http://127.0.0.1:${PORT}/_puts" | jq length)" == 1 ]]'

echo "10. mixed backend/frontend revisions roll back together"
start_mock mixed ahead; run_deploy 35
check "exits non-zero and rolls back" '[[ $RC -ne 0 && "$(puts | jq length)" == 2 ]]'
check "reports rollback" 'grep -q "rolled back to previous images" "$OUT"'
common_checks

echo "11. stack responds but Docker inspection fails -> unknown, no rollback"
start_mock inspection-fails ahead; run_deploy 35
check "exits non-zero with unknown state" '[[ $RC -ne 0 ]] && grep -q "STATE UNKNOWN" "$OUT"'
check "no rollback sent" '[[ "$(puts | jq length)" == 1 ]]'

echo "12. unrelated stack changes during rollout -> unknown, preserve operator changes"
start_mock changed-config ahead; run_deploy 35
check "reports unknown state" '[[ $RC -ne 0 ]] && grep -q "STATE UNKNOWN" "$OUT"'
check "no rollback sent" '[[ "$(puts | jq length)" == 1 ]]'

echo "13. outage before rollout -> unknown, no mutation"
start_mock outage-before ahead; run_deploy 35
check "reports unknown state" '[[ $RC -ne 0 ]] && grep -q "STATE UNKNOWN" "$OUT"'
check "no update sent" '[[ "$(puts | jq length)" == 0 ]]'

echo "14. Docker health failure rejects a release even when HTTP responds"
start_mock unhealthy ahead; run_deploy 35
check "exits non-zero and rolls back" '[[ $RC -ne 0 && "$(puts | jq length)" == 2 ]]'
common_checks

echo "15. frontend revision mismatch rejects the release"
start_mock wrong-frontend-label ahead; run_deploy 35
check "exits non-zero and rolls back" '[[ $RC -ne 0 && "$(puts | jq length)" == 2 ]]'
common_checks

if (( failures )); then echo "${failures} check(s) failed"; exit 1; fi
echo "all deploy script scenarios passed"
