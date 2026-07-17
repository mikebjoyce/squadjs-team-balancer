#!/bin/sh
set -e

SQUADJS_APP="${SQUADJS_APP:-/squadjs}"

# Build merged workspace matching SquadJS directory layout:
#   /app/core/           <- SquadJS core (logger, etc.)
#   /app/squad-server/   <- merged squad-server + project files
#
# This is required because imports use ../../core/logger.js
# which resolves relative to the squad-server subdirectories.

mkdir -p /app
ln -sf "$SQUADJS_APP/core" /app/core

# Start from SquadJS squad-server base, then overlay project files
cp -a "$SQUADJS_APP/squad-server/." /app/squad-server/
cp -a /project/plugins/. /app/squad-server/plugins/
cp -a /project/utils/. /app/squad-server/utils/
cp -a /project/testing/. /app/squad-server/testing/

# Symlink node_modules so ESM package resolution works
# (NODE_PATH is ignored by ESM imports)
ln -sf "$SQUADJS_APP/node_modules" /app/squad-server/node_modules
ln -sf "$SQUADJS_APP/node_modules" /app/node_modules

cd /app/squad-server

CMD="${1:-all}"
shift 2>/dev/null || true

case "$CMD" in
  scrambler)
    echo "Running scrambler tests..."
    node testing/scrambler-test-runner.js "$@"
    ;;
  plugin)
    echo "Running plugin logic tests..."
    node testing/plugin-logic-test-runner.js "$@"
    ;;
  elo)
    echo "Running ELO integration test..."
    node testing/elo-integration-test.js "$@"
    ;;
  historical-scramble)
    if [ -z "$1" ]; then
      echo "Usage: historical-scramble <elodb.json> [matchlog.jsonl]" >&2
      echo "Note: paths should be relative to the container, e.g. /data/elodb.json" >&2
      exit 1
    fi
    echo "Running historical scramble test..."
    node testing/historical-scramble-test.js "$@"
    ;;
  historical-backbone)
    if [ -z "$1" ]; then
      echo "Usage: historical-backbone <elodb.json>" >&2
      echo "Note: paths should be relative to the container, e.g. /data/elodb.json" >&2
      exit 1
    fi
    echo "Running historical backbone test..."
    node testing/historical-elo-backbone-test.js "$@"
    ;;
  all)
    echo "Running all standalone tests..."
    node testing/scrambler-test-runner.js
    echo ""
    node testing/plugin-logic-test-runner.js
    # Note: elo-integration-test.js has a broken import path
    # (imports '../core/logger.js' which doesn't resolve under squad-server/);
    # run via 'elo' once fixed.
    ;;
  *)
    exec "$CMD" "$@"
    ;;
esac
