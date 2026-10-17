#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL only: no .env, external DSN, published port or cloud API.
cd "$(dirname "$0")/.."
container="creditbook-g01-test-$(date +%s)-$$"
# Pin the tested upstream image; update deliberately alongside test evidence.
image='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
created=false
cleanup() {
  if [ "$created" = true ]; then
    docker --context colima rm -f "$container" >/dev/null
  fi
}
trap cleanup EXIT
docker --context colima run --name "$container" --label creditbook.test=g01 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -d "$image" >/dev/null
created=true
for attempt in {1..30}; do
  if docker --context colima exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sql() {
  echo "Checking $1"
  docker --context colima exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres < "$1"
}
sql tests/database/auth-fixture.sql
sql supabase/schema.sql
for migration in supabase/migrations/*.sql; do
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
docker --context colima image inspect "$image" --format '{{json .RepoDigests}}'
echo 'PASS: PostgreSQL migration/RLS tests (not full Supabase E2E).'
