#!/usr/bin/env bash
# Integration test for a freshly demo-seeded worktree. Re-run the seed and compare its rows.
set -euo pipefail
dev=$(dirname "$0")/dev.sh
snapshot() {
    "$dev" psql -XAt -v ON_ERROR_STOP=1 <<'SQL'
WITH demo AS (
  SELECT p.id, p.name FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id
  JOIN "user" u ON u.id = m.user_id WHERE u.email = 'admin@example.com'
), rows AS (
  SELECT 'connection' AS kind, p.name, to_jsonb(c) AS data FROM github_connections c JOIN demo p ON c.project_id = p.id
  UNION ALL SELECT 'link', p.name, to_jsonb(l) FROM task_github_links l JOIN demo p ON l.project_id = p.id
  UNION ALL SELECT 'release', p.name, to_jsonb(r) FROM github_releases r JOIN demo p ON r.project_id = p.id
  UNION ALL SELECT 'binding', p.name, to_jsonb(b) FROM task_github_releases b JOIN demo p ON b.project_id = p.id
)
SELECT count(*) FILTER (WHERE name <> 'Throw'),
       count(*) FILTER (WHERE kind = 'connection' AND data->>'enabled' = 'true'),
       count(*) FILTER (WHERE kind = 'link'),
       count(*) FILTER (WHERE kind = 'release' AND data->>'tag_name' = 'v0.1.0'),
       count(*) FILTER (WHERE kind = 'binding'),
       md5(string_agg(data::text, '' ORDER BY data::text))
FROM rows;
SQL
}
before=$(snapshot)
# One connection, nine task links, one release and two bindings.
[[ $before == '0|1|9|1|2|'* ]] || { echo 'Expected fresh demo GitHub fixtures.' >&2; exit 1; }
"$dev" seed demo
[[ $(snapshot) == "$before" ]] || { echo 'The second seed changed demo GitHub rows.' >&2; exit 1; }
echo 'GitHub demo rows survived a second seed unchanged.'
