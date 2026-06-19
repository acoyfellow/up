# Up

Use Up when the user asks for a small company-private website, prototype, dashboard, poll, presentation, or internal tool.

## Build contract

1. Build framework-free output into `./dist` unless the project already has a build system.
2. Include `dist/index.html`.
3. Keep each file under 10 MiB and the folder under 50 MiB.
4. Do not put credentials in browser code.
5. Use the fixed Up browser module for stateful features:

```js
import { up } from '/_up/client.js';
```

Available capabilities:

```js
await up.identity.current();
const records = up.db.collection('records');
await records.create({ title: 'Hello' });
await up.files.put('file.txt', new Blob(['hello']));
await up.ai.chat([{ role: 'user', content: 'Summarize this' }]);
const room = up.realtime.channel('main');
room.on('update', console.log);
room.send('update', { ok: true });
```

6. Test the local static files before publishing.
7. Publish only after the user approves the folder and site name:

```sh
up deploy ./dist <site-name>
```

8. Return the company-private URL printed by Up.

Do not ask the user about R2, Durable Objects, Access, bindings, databases, secrets, schedules, or Workers. Those belong to the company installation.
