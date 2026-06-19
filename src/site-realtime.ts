import { DurableObject } from 'cloudflare:workers';

interface RealtimeEnv extends Cloudflare.Env {}

export class SiteRealtime extends DurableObject<RealtimeEnv> {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/connect')
      return new Response('Not found', { status: 404 });
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return Response.json({ error: 'WebSocket upgrade required' }, { status: 426 });
    const email = request.headers.get('x-up-email');
    const site = request.headers.get('x-up-site');
    const channel = request.headers.get('x-up-channel');
    if (!email || !site || !channel)
      return Response.json({ error: 'Identity required' }, { status: 403 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [email]);
    server.serializeAttachment({ email, site, channel });
    this.broadcast({ type: 'presence', event: 'join', email }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as
      | { email: string; site: string; channel: string }
      | undefined;
    if (!attachment) return socket.close(1008, 'Missing identity');
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    if (text.length > 16_384) return socket.close(1009, 'Message too large');
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
    }
    if (!input || typeof input !== 'object') return;
    const value = input as Record<string, unknown>;
    if (typeof value.type !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(value.type))
      return socket.send(JSON.stringify({ type: 'error', error: 'Invalid event type' }));
    const encoded = JSON.stringify({
      type: value.type,
      data: value.data ?? null,
      sender: attachment.email,
    });
    if (encoded.length > 16_384) return socket.close(1009, 'Message too large');
    this.broadcast(JSON.parse(encoded));
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as { email?: string } | undefined;
    if (attachment?.email)
      this.broadcast({ type: 'presence', event: 'leave', email: attachment.email }, socket);
  }

  private broadcast(value: unknown, except?: WebSocket): void {
    const encoded = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) {
        try {
          socket.send(encoded);
        } catch {
          // The runtime will deliver webSocketClose and remove dead sockets.
        }
      }
    }
  }
}
