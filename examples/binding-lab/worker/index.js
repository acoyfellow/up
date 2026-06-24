const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    const visits = ((await this.state.storage.get('visits')) || 0) + 1;
    await this.state.storage.put('visits', visits);
    return json({ visits });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state' && request.method === 'GET') {
      const pageViews = Number((await env.CACHE.get('page-views')) || 0) + 1;
      await env.CACHE.put('page-views', String(pageViews));

      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, created_at TEXT NOT NULL)',
      ).run();
      const notes = await env.DB.prepare(
        'SELECT id, body, created_at AS createdAt FROM notes ORDER BY id DESC LIMIT 6',
      ).all();

      const room = env.ROOMS.get(env.ROOMS.idFromName('main'));
      const roomState = await room
        .fetch('https://room.internal/state')
        .then((response) => response.json());

      return json({ pageViews, roomVisits: roomState.visits, notes: notes.results || [] });
    }

    if (url.pathname === '/api/notes' && request.method === 'POST') {
      const input = await request.json().catch(() => null);
      const body = typeof input?.body === 'string' ? input.body.trim().slice(0, 240) : '';
      if (!body) return json({ error: 'Write a note first.' }, 400);
      await env.DB.prepare('INSERT INTO notes (body, created_at) VALUES (?, ?)')
        .bind(body, new Date().toISOString())
        .run();
      return json({ stored: true }, 201);
    }

    return env.ASSETS.fetch(request);
  },
};
