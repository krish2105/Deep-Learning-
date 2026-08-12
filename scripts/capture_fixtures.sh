#!/usr/bin/env bash
# Capture the demo sandbox's real outputs as offline fixtures.
#
# The offline demo must show what the system actually produced, not hand-written
# numbers, so the fixtures are captured from a running instance rather than
# authored. Run with the API and inference core up:
#
#   cd services/inference && uvicorn app:app --port 7860 &
#   cd apps/api && INFERENCE_URL=http://localhost:7860 uvicorn app.main:app --port 8000 &
#   ./scripts/capture_fixtures.sh
set -euo pipefail
API="${API:-http://localhost:8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TOKEN=$(curl -sf -X POST "$API/api/v1/auth/demo" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -sf "$API/api/v1/studies" -H "Authorization: Bearer $TOKEN" -o /tmp/studies_raw.json

python3 "$ROOT/scripts/_pack_fixtures.py"
echo "Wrote apps/web/lib/demoFixtures.ts"
