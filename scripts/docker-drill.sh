#!/usr/bin/env bash
# Restart and restore drill against the Docker image (§12.2, T22).
#
#   scripts/docker-drill.sh [image]   (default plato:ci)
#
# Starts the image on a named volume, then checks that:
#   1. data written to the database survives a container restart, and a
#      replacement container on the same volume;
#   2. `db:backup` in the container writes a backup, and `db:restore` plus a
#      restart puts the database back as it was at the backup.
# Requests are written straight to SQLite and read back through the pipeline
# endpoint, so the running server is what is checked.
set -euo pipefail

image=${1:-plato:ci}
name=plato-drill
volume=plato-drill-data
port=${DRILL_PORT:-3200}
passcode=drill-passcode-at-least-20-chars
url=http://127.0.0.1:$port

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

start() {
  docker run -d --name "$name" -p "$port:3000" -v "$volume:/data" \
    -e PLATO_PASSCODE=$passcode -e PLATO_COOKIE_SECRET=drill-cookie-secret \
    "$image" >/dev/null
  wait_ready
}

wait_ready() {
  for _ in $(seq 1 30); do
    if curl -fsS "$url/unlock" -o /dev/null 2>/dev/null; then return; fi
    sleep 1
  done
  docker logs "$name"
  echo "server did not start"
  exit 1
}

add_request() {
  docker exec "$name" node -e "
    const db = require('better-sqlite3')(process.env.PLATO_DB_PATH);
    db.prepare('INSERT INTO course_request (id, text, created_at) VALUES (?, ?, ?)').run('$1', 'Drill $1', Date.now());
  "
}

# The open requests' ids, sorted, one per line.
requests() {
  curl -fsS -H "authorization: Bearer $passcode" "$url/api/pipeline/requests" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(r=>r.id).sort().join(" ")))'
}

expect_requests() {
  local got
  got=$(requests)
  if [ "$got" != "$1" ]; then
    docker logs "$name"
    echo "after $2: expected requests [$1], got [$got]"
    exit 1
  fi
  echo "ok: $2 -> [$got]"
}

start
if docker logs "$name" 2>&1 | grep -q "not on its own mounted volume"; then
  echo "the server warned that /data is not a mounted volume"
  exit 1
fi
expect_requests "" "first start"

add_request a
expect_requests "a" "writing a request"

docker restart "$name" >/dev/null
wait_ready
expect_requests "a" "a restart"

docker rm -f "$name" >/dev/null
start
expect_requests "a" "a new container on the same volume"

docker exec "$name" node scripts/db-backup.ts /data/backups/drill.db
add_request b
expect_requests "a b" "a write after the backup"

docker exec "$name" node scripts/db-restore.ts /data/backups/drill.db
docker restart "$name" >/dev/null
wait_ready
docker logs "$name" 2>&1 | grep -q "Restored the database" ||
  { docker logs "$name"; echo "no restore message at start"; exit 1; }
expect_requests "a" "restoring the backup"
docker exec "$name" sh -c 'ls /data/plato.db.pre-restore-* >/dev/null' ||
  { echo "the replaced database was not kept"; exit 1; }

echo "drill passed"
