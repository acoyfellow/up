# Dynamic baseline

`examples/dynamic-site` is the deterministic production fixture for Up's optional server runtime.

It contains:

- `index.html` — static shell
- `_worker.js` — isolated `/api/receipt` backend

Publish it with database access enabled. Interactive and scheduled requests append receipt rows to the site's isolated SQLite Durable Object. The response proves the Dynamic Worker runtime and database binding without using secrets or outbound network access.

Expected API receipt:

```json
{
  "runtime": "dynamic-worker",
  "outbound": "blocked-by-default",
  "database": [{ "kind": "interactive", "created_at": "..." }],
  "scheduled": false
}
```
