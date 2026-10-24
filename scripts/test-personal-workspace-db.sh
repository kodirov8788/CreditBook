#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL only: no .env, external DSN, published port or cloud API.
cd "$(dirname "$0")/.."
container="creditbook-g01-test-$(date +%s)-$$"
# Pin the tested upstream image; update deliberately alongside test evidence.
image='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
pilot_migration='supabase/migrations/20261019055603_personal_pilot_access.sql'
book_migration='supabase/migrations/20261019063444_personal_single_book.sql'
created=false
cleanup() {
  if [ "$created" = true ]; then
    docker --context colima rm -f "$container" >/dev/null
  fi
}
trap cleanup EXIT
docker --context colima run --network none --name "$container" --label creditbook.test=g01 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -d "$image" >/dev/null
created=true
ready=false
for attempt in {1..30}; do
  # The bootstrap Unix-socket server restarts before the final TCP server.
  if docker --context colima exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo 'FAIL: disposable PostgreSQL did not become ready.' >&2
  exit 1
fi
sql() {
  echo "Checking $1"
  docker --context colima exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < "$1"
}
sql tests/database/auth-fixture.sql
sql supabase/schema.sql
for migration in supabase/migrations/*.sql; do
  # Historical foundation assertions run against their pre-pilot contract;
  # then exercise the pilot migration and final security state below.
  if [[ "$migration" == "$pilot_migration" ]]; then break; fi
  if [[ "$migration" == *20261017011017_personal_workspace_foundation.sql ]]; then
    sql tests/database/personal-workspace-before.sql
  fi
  sql "$migration"
done
sql tests/database/personal-workspace.sql
sql tests/database/personal-workspace-concurrent.sql &
first_caller=$!
sql tests/database/personal-workspace-concurrent.sql &
second_caller=$!
wait "$first_caller"
wait "$second_caller"
sql tests/database/personal-workspace-concurrent-check.sql
sql tests/database/personal-pilot-before.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" < "$pilot_migration" ]]; then continue; fi
  if [[ "$migration" == "$book_migration" ]]; then
    sql tests/database/personal-pilot.sql
    sql tests/database/personal-book-before.sql
  fi
  sql "$migration"
done
sql tests/database/personal-book.sql
docker --context colima image inspect "$image" --format '{{json .RepoDigests}}'
echo 'PASS: PostgreSQL migration/RLS tests (not full Supabase E2E).'
