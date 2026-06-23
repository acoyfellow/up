# Company-mode site database

> This reference applies only to the secondary `up private` installation. Anonymous static deployments do not receive this API.

Each company-mode site resolves one SQLite Durable Object from its authenticated hostname. Browser code receives document collections rather than a raw SQL interface:

```js
import { up } from '/_up/client.js';

const notes = up.db.collection('notes');
const created = await notes.create({ body: 'hello' });
await notes.get(created.id);
await notes.list({ limit: 50, offset: 0 });
await notes.update(created.id, { body: 'updated' });
await notes.delete(created.id);
```

Contracts:

- collection names are lowercase identifiers up to 48 characters;
- document IDs contain letters, numbers, `_`, or `-` and are at most 64 characters;
- documents are JSON objects up to 64 KiB;
- a list returns at most 100 documents;
- site scope comes from the authenticated hostname;
- browser code cannot select another site's Durable Object.
