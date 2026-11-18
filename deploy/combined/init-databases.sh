#!/usr/bin/env bash
set -euo pipefail
# Separate owners; each can create its restore scratch database. REPLICATION is for Electric.
# Cluster administration credentials are never passed to either application.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=catch_password="$CATCH_DATABASE_PASSWORD" \
    --set=throw_password="$THROW_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE catch LOGIN CREATEDB REPLICATION PASSWORD :'catch_password';
CREATE ROLE throw LOGIN CREATEDB REPLICATION PASSWORD :'throw_password';
CREATE DATABASE catch OWNER catch;
CREATE DATABASE throw OWNER throw;
REVOKE CONNECT ON DATABASE catch FROM PUBLIC;
REVOKE CONNECT ON DATABASE throw FROM PUBLIC;
GRANT CONNECT ON DATABASE catch TO catch;
GRANT CONNECT ON DATABASE throw TO throw;
SQL
