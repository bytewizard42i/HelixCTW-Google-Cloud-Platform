#!/bin/bash
# pull-diagnostics.sh — download visitor diagnostics into the repo.
#
# WHAT THIS DOES (plain English):
#   Visitors' browsers send tiny anonymous snapshots (browser name, screen
#   size, which step failed and why) to our API, which stores them as JSON
#   files in our private GCS bucket under diagnostics/.  This script copies
#   any new ones into the local `diagnostics/` folder so we can read them.
#
# HOW TO RUN:
#   bash scripts/pull-diagnostics.sh
#
# FLAG DECODER:
#   gcloud storage cp   = copy files from Google Cloud Storage (like scp)
#   -r                  = recursive: include the whole diagnostics/ tree
#   -n                  = no-clobber: skip files we already downloaded
#
# The diagnostics/ folder is git-ignored: visitor data stays out of the
# public repository.
set -e
cd "$(dirname "$0")/.."
mkdir -p diagnostics
gcloud storage cp -r -n \
  "gs://helixctw-gcp-testwired-audit-receipts/diagnostics/*" \
  diagnostics/ \
  --project=helixctw-gcp-testwired 2>/dev/null \
  || echo "No diagnostics recorded yet."
echo "Local diagnostics:"
find diagnostics -name '*.json' | sort | tail -20
