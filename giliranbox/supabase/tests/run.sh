#!/bin/sh
# Usage: tests/run.sh  (needs local Postgres 16 + PostGIS; creates database "gb")
set -e
cd "$(dirname "$0")/.."
D="psql -X -q -t -A -v ON_ERROR_STOP=1 -U postgres -d gb"
su postgres -c "psql -q -c 'drop database if exists gb' -c 'create database gb'"
for f in tests/00_stub_supabase.sql migrations/*.sql seed.sql tests/10_flows.sql; do
  echo "== $f"; su postgres -c "$D -f $PWD/$f"
done
echo "ALL SQL TESTS PASSED"
