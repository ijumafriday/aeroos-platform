#!/usr/bin/env bash
set -euo pipefail
# Verifies that a Kubernetes secret rotation is actually consumed by a workload.
# The caller performs the secret update; this script compares pod template/resource generations and health before/after.
NS="${NAMESPACE:-default}"
DEPLOY="${1:-}"
SECRET="${2:-}"
TIMEOUT="${ROTATION_TIMEOUT_SECONDS:-180}"
[ -n "$DEPLOY" ] && [ -n "$SECRET" ] || { echo "usage: $0 <deployment> <secret>" >&2; exit 2; }
command -v kubectl >/dev/null || { echo 'kubectl required' >&2; exit 2; }
old_secret=$(kubectl -n "$NS" get secret "$SECRET" -o jsonpath='{.metadata.resourceVersion}')
old_rs=$(kubectl -n "$NS" get deploy "$DEPLOY" -o jsonpath='{.metadata.generation}')
selector=$(kubectl -n "$NS" get deploy "$DEPLOY" -o jsonpath='{range $k,$v := .spec.selector.matchLabels}{$k}={$v},{end}' | sed 's/,$//')
old_pods=$(kubectl -n "$NS" get pods -l "$selector" -o jsonpath='{range .items[*]}{.metadata.uid}{"\n"}{end}' | sort)
echo "READY deployment=$DEPLOY secret=$SECRET secretResourceVersion=$old_secret deploymentGeneration=$old_rs"
echo "Rotate the secret in the configured external secret manager now; waiting for a changed Kubernetes Secret resourceVersion and a healthy rollout." >&2
start=$(date +%s)
while :; do
  new_secret=$(kubectl -n "$NS" get secret "$SECRET" -o jsonpath='{.metadata.resourceVersion}' 2>/dev/null || true)
  if [ -n "$new_secret" ] && [ "$new_secret" != "$old_secret" ]; then break; fi
  [ $(( $(date +%s)-start )) -lt "$TIMEOUT" ] || { echo 'FAIL secret resourceVersion did not change'; exit 1; }
  sleep 3
done
# Deployment must be restarted/reloaded by the operator/controller; force nothing here so the test proves automation.
while :; do
  new_pods=$(kubectl -n "$NS" get pods -l "$selector" -o jsonpath='{range .items[*]}{.metadata.uid}{"\n"}{end}' 2>/dev/null | sort || true)
  if [ -n "$new_pods" ] && [ "$new_pods" != "$old_pods" ] && kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=5s >/dev/null 2>&1; then
    echo "PASS deployment=$DEPLOY secret=$SECRET oldSecretResourceVersion=$old_secret newSecretResourceVersion=$new_secret podsReplaced=true recoverySeconds=$(( $(date +%s)-start ))"
    exit 0
  fi
  [ $(( $(date +%s)-start )) -lt "$TIMEOUT" ] || { echo 'FAIL workload did not become ready after secret rotation'; exit 1; }
  sleep 3
done
