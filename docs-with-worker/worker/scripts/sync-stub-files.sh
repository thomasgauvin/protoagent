#!/bin/bash
# Sync stub-files/ directory into src/stub-files.ts
# Run this after editing files in stub-files/
#
# Usage: bash scripts/sync-stub-files.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STUB_DIR="$PROJECT_ROOT/stub-files"
OUTPUT_FILE="$PROJECT_ROOT/src/stub-files.ts"

echo "Syncing stub files from $STUB_DIR to $OUTPUT_FILE..."

# Use Node.js script for proper escaping
node "$SCRIPT_DIR/sync-stub-files.mjs"
