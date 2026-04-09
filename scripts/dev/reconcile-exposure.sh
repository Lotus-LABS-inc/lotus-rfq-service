#!/bin/bash
# Risk Exposure Reconciliation Script
# This script is intended to be run via cron (Hourly/Nightly)
# Usage: ./reconcile-exposure.sh [hourly|nightly]

MODE=${1:-hourly}
export RISK_AUTO_FIX=${RISK_AUTO_FIX:-false}

echo "[$(date)] Starting risk reconciliation - Mode: $MODE, Auto-Fix: $RISK_AUTO_FIX"

if [ "$MODE" == "nightly" ]; then
  # Nightly full reconcile runs against all rows
  npx tsx src/jobs/reconcile-exposure.job.ts --full
else
  # Hourly incremental (batches recent changes)
  npx tsx src/jobs/reconcile-exposure.job.ts
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date)] Reconciliation completed successfully."
else
  echo "[$(date)] Reconciliation failed or found discrepancies (Auto-fix: $RISK_AUTO_FIX)."
fi

exit $EXIT_CODE
