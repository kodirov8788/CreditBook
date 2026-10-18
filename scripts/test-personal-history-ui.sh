#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
fixture='app/local-history-fixture'
if [ -e "$fixture" ]; then echo 'Refusing to overwrite an existing fixture path.' >&2; exit 1; fi
port="${PERSONAL_HISTORY_TEST_PORT:-3101}"
log="$(mktemp -t creditbook-history-ui)"
types_backup="$(mktemp -t creditbook-next-env)"
cp next-env.d.ts "$types_backup"
server_pid=''
cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -f "$fixture/page.tsx"
  rmdir "$fixture"
  # Next dev validators reference the temporary route after it is removed.
  rm -rf .next/dev/types
  cp "$types_backup" next-env.d.ts
  rm -f "$types_backup"
  echo "Local Next server log: $log"
}
trap cleanup EXIT
mkdir "$fixture"
cat > "$fixture/page.tsx" <<'PAGE'
"use client";
import AccountCard from "@/components/personal/account-card";
const account={id:"11111111-1111-4111-8111-111111111111",name:"Naqd",icon:"cash",color:"#18794E",currencyCode:"UZS",scale:2,status:"active",includeInTotal:true,version:1,balanceMinor:"10000000"} as const;
export default function Fixture(){return <main><AccountCard account={account} isDefault disabled={false} onManage={()=>{}}/></main>;}
PAGE
# No Auth sessions or cloud API calls. Route responses are Playwright fixtures.
NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='' \
SUPABASE_URL='' SUPABASE_PUBLISHABLE_KEY='' \
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port "$port" > "$log" 2>&1 &
server_pid=$!
ready=false
for attempt in {1..60}; do
  if curl --silent --fail "http://127.0.0.1:$port/local-history-fixture" >/dev/null; then ready=true; break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then cat "$log"; exit 1; fi
  sleep 1
done
if [ "$ready" != true ]; then cat "$log"; exit 1; fi
E2E_BASE_URL="http://127.0.0.1:$port" \
PERSONAL_CARD_FIXTURE_URL="http://127.0.0.1:$port/local-history-fixture" \
node_modules/.bin/playwright test tests/e2e/personal-history.spec.ts --workers=1
