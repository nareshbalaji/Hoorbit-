#!/bin/sh
# Usage: tests/perf.sh   (runs run.sh first to build the DB, then the synthetic benchmark)
set -e
cd "$(dirname "$0")"
./run.sh >/dev/null
su postgres -c "psql -X -d gb -v ON_ERROR_STOP=1 -f $PWD/20_perf.sql"
