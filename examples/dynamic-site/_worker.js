async function database(env, sql, params = []) {
  if (!env.UP_DB) return { error: 'database-disabled' };
  const response = await env.UP_DB.fetch('https://database.internal/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  return response.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/receipt') {
      await database(env, 'CREATE TABLE IF NOT EXISTS receipts(id INTEGER PRIMARY KEY, kind TEXT, created_at TEXT)');
      await database(env, 'INSERT INTO receipts(kind,created_at) VALUES (?,?)', [
        request.headers.get('x-up-schedule') ? 'scheduled' : 'interactive',
        new Date().toISOString(),
      ]);
      const result = await database(env, 'SELECT kind,created_at FROM receipts ORDER BY id DESC LIMIT 10');
      return Response.json({
        runtime: 'dynamic-worker',
        outbound: 'blocked-by-default',
        database: result.rows || [],
        scheduled: Boolean(request.headers.get('x-up-schedule')),
      });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
