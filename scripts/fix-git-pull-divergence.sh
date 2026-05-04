#!/usr/bin/env bash
set -euo pipefail

# Configure a default pull strategy to avoid:
# "fatal: Need to specify how to reconcile divergent branches."

MODE="${1:-rebase}"
SCOPE="${2:-local}"

if [[ "$SCOPE" != "local" && "$SCOPE" != "global" ]]; then
  echo "Usage: $0 [rebase|merge|ff-only] [local|global]"
  exit 1
fi

CONFIG_CMD=(git config)
if [[ "$SCOPE" == "global" ]]; then
  CONFIG_CMD=(git config --global)
fi

case "$MODE" in
  rebase)
    "${CONFIG_CMD[@]}" pull.rebase true
    "${CONFIG_CMD[@]}" --unset pull.ff 2>/dev/null || true
    echo "Configured: git pull uses rebase ($SCOPE)."
    ;;
  merge)
    "${CONFIG_CMD[@]}" pull.rebase false
    "${CONFIG_CMD[@]}" --unset pull.ff 2>/dev/null || true
    echo "Configured: git pull uses merge ($SCOPE)."
    ;;
  ff-only)
    "${CONFIG_CMD[@]}" pull.ff only
    "${CONFIG_CMD[@]}" --unset pull.rebase 2>/dev/null || true
    echo "Configured: git pull uses fast-forward only ($SCOPE)."
    ;;
  *)
    echo "Usage: $0 [rebase|merge|ff-only] [local|global]"
    exit 1
    ;;
esac

CURRENT_REBASE=$(git config --get pull.rebase || echo "<unset>")
CURRENT_FF=$(git config --get pull.ff || echo "<unset>")

echo "pull.rebase=$CURRENT_REBASE"
echo "pull.ff=$CURRENT_FF"
