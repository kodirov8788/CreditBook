#!/usr/bin/env bash
set -euo pipefail

# Disposable PostgreSQL only: no .env, external DSN, published port, or cloud API.
cd "$(dirname "$0")/.."
if [[ $# -gt 1 || ( $# -eq 1 && "${1:-}" != '--shop-read-model' && "${1:-}" != '--pending-upgrade' ) ]]; then
  echo 'Usage: test-personal-account-db.sh [--shop-read-model|--pending-upgrade]' >&2
  exit 2
fi
container="creditbook-g02-test-$(date +%s)-$$"
# Pin the tested upstream image; change deliberately alongside the evidence.
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

docker --context colima run --pull=never --name "$container" --label creditbook.test=g02 --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -d "$image" >/dev/null
created=true

ready=false
for attempt in {1..30}; do
  # The bootstrap server accepts Unix sockets before restarting. Its TCP port
  # stays disabled; wait for the final server rather than racing that restart.
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
  local input_file="$1"
  shift
  echo "Checking $input_file"
  docker --context colima exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres "$@" < "$input_file"
}

sql tests/database/auth-fixture.sql
sql supabase/schema.sql
if [[ "${1:-}" == '--pending-upgrade' ]]; then
  # Rehearse the observed hosted migration boundary, using synthetic rows ONLY.
  # No hosted connection or migration-history repair is performed.
  baseline='supabase/migrations/20261017031547_personal_account_opening_foundation.sql'
  for migration in supabase/migrations/*.sql; do
    if [[ "$migration" > "$baseline" ]]; then break; fi
    if [[ "$migration" == 'supabase/migrations/202608200003_atomic_activity_audit.sql' ]]; then
      sql tests/database/backfill-repair-before.sql
    fi
    sql "$migration"
    if [[ "$migration" == 'supabase/migrations/20260820155850_activity_expense_reminder_backfill.sql' ]]; then
      sql tests/database/backfill-repair-after.sql
      sql "$migration"
      sql tests/database/backfill-repair-after.sql
    fi
  done
  sql tests/database/personal-pilot-before.sql
  sql tests/database/pending-upgrade-before.sql
  sql supabase/migrations/20260820155850_activity_expense_reminder_backfill.sql
  for migration in supabase/migrations/*.sql; do
    if [[ "$migration" > "$baseline" ]]; then sql "$migration"; fi
  done
  sql tests/database/pending-upgrade-after.sql
  echo 'PASS: eight pending migrations preserve synthetic baseline; historical version aligned locally only.'
  exit 0
fi
if [[ "${1:-}" == '--shop-read-model' ]]; then
  for migration in supabase/migrations/*.sql; do sql "$migration"; done
  sql tests/database/shop-read-model.sql
  docker --context colima image inspect "$image" --format '{{json .RepoDigests}}'
  echo 'PASS: shop aggregate migration/RLS/pagination tests (PostgreSQL only, not HTTP/browser).'
  exit 0
fi
for migration in supabase/migrations/*.sql; do
  # Verify legacy account behavior first, then pilot revocation and RLS on the
  # same preserved records. Do not weaken the final-state pilot assertions.
  if [[ "$migration" == "$pilot_migration" ]]; then break; fi
  sql "$migration"
done
sql tests/database/personal-account.sql
sql tests/database/personal-account-read.sql
sql tests/database/personal-account-management.sql
sql tests/database/personal-account-management-concurrent.sql -v caller='Race first' &
manage_first=$!
sql tests/database/personal-account-management-concurrent.sql -v caller='Race second' &
manage_second=$!
wait "$manage_first"
wait "$manage_second"
sql tests/database/personal-account-management-concurrent-check.sql
sql tests/database/personal-account-concurrent.sql &
first_caller=$!
sql tests/database/personal-account-concurrent.sql &
second_caller=$!
wait "$first_caller"
wait "$second_caller"
sql tests/database/personal-account-concurrent.sql -v conflict_name='Conflicting A' &
first_caller=$!
sql tests/database/personal-account-concurrent.sql -v conflict_name='Conflicting B' &
second_caller=$!
wait "$first_caller"
wait "$second_caller"
sql tests/database/personal-account-concurrent-check.sql
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
for different_keys in false true; do
  sql tests/database/personal-book-concurrent.sql -v different_keys="$different_keys" &
  book_first=$!
  sql tests/database/personal-book-concurrent.sql -v different_keys="$different_keys" &
  book_second=$!
  sql tests/database/personal-book-concurrent-observe.sql
  wait "$book_first"
  wait "$book_second"
done
sql tests/database/personal-book-concurrent-check.sql
sql tests/database/shop-read-model.sql
docker --context colima image inspect "$image" --format '{{json .RepoDigests}}'
echo 'PASS: personal-account migration/RLS/RPC tests (not full Supabase E2E).'
