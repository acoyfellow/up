# Site database

Dynamic Up sites can opt into an isolated SQLite database. The database is a dedicated Durable Object instance named for the site; sites never receive the namespace and cannot address another site's object.

The Dynamic Worker receives one `UP_DB` stub when database access is enabled. It uses the standard binding fetch interface:

```js
const response = await env.UP_DB.fetch('https://database.internal/query', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sql: 'SELECT body FROM notes WHERE id = ?',
    params: [1],
  }),
});
const { rows } = await response.json();
```

Limits:

- one SQL statement per call
- 20,000 SQL characters
- 100 scalar parameters
- 1,000 returned rows
- `ATTACH`, `DETACH`, `PRAGMA`, and `VACUUM` are rejected

Only the site owner or an Up administrator can enable or disable the database. Disabling is destructive: the Durable Object storage is deleted before the API reports success. Dynamic code receives no database binding while disabled.
