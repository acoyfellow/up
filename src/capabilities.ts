import type { Identity, SiteRecord } from './core';
import type { Env } from './core-backend';

const secure = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: secure });
const collectionPattern = /^[a-z][a-z0-9_-]{0,47}$/;
const channelPattern = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AI_INPUT = 20_000;

function siteFilePath(pathname: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!value || value.length > 240 || value.includes('..') || /[\\\0]/.test(value)) return null;
  return value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function fileKey(site: string, path: string): string {
  return `site-files/${site}/${path}`;
}

function clientModule(): string {
  return `const request=async(path,init={})=>{const response=await fetch('/_up/'+path,{...init,headers:{...init.headers,'accept':'application/json'}});if(!response.ok){let body={};try{body=await response.json()}catch{}throw new Error(body.error||('Up request failed: '+response.status))}const type=response.headers.get('content-type')||'';return type.includes('application/json')?response.json():response};
const collection=(name)=>({
 create:(data)=>request('db/'+encodeURIComponent(name),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),
 get:(id)=>request('db/'+encodeURIComponent(name)+'/'+encodeURIComponent(id)),
 list:(options={})=>request('db/'+encodeURIComponent(name)+'?'+new URLSearchParams({limit:String(options.limit||100),offset:String(options.offset||0)})),
 update:(id,data)=>request('db/'+encodeURIComponent(name)+'/'+encodeURIComponent(id),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),
 delete:(id)=>request('db/'+encodeURIComponent(name)+'/'+encodeURIComponent(id),{method:'DELETE'})
});
const channel=(name)=>{let socket,listeners=new Map();const emit=(type,value)=>{for(const fn of listeners.get(type)||[])fn(value)};return{
 connect(){if(socket&&socket.readyState<=1)return socket;const protocol=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(protocol+'//'+location.host+'/_up/realtime/'+encodeURIComponent(name));socket.onmessage=(event)=>{try{const message=JSON.parse(event.data);emit(message.type,message)}catch{emit('message',event.data)}};socket.onopen=()=>emit('open',{});socket.onclose=()=>emit('close',{});return socket},
 on(type,fn){const set=listeners.get(type)||new Set();set.add(fn);listeners.set(type,set);return()=>set.delete(fn)},
 send(type,data){const ws=this.connect();const payload=JSON.stringify({type,data});if(ws.readyState===WebSocket.OPEN)ws.send(payload);else ws.addEventListener('open',()=>ws.send(payload),{once:true})},
 close(){socket?.close()}
}};
export const up={
 identity:{current:()=>request('identity')},
 db:{collection},
 files:{
  put:async(name,file)=>{const response=await fetch('/_up/files/'+encodeURIComponent(name),{method:'PUT',headers:{'content-type':file.type||'application/octet-stream'},body:file});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Upload failed');return response.json()},
  get:(name)=>fetch('/_up/files/'+encodeURIComponent(name)).then(response=>{if(!response.ok)throw new Error('File not found');return response}),
  list:()=>request('files'),
  delete:(name)=>request('files/'+encodeURIComponent(name),{method:'DELETE'})
 },
 ai:{chat:(messages)=>request('ai/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages})})},
 realtime:{channel}
};
export default up;
`;
}

async function databaseRequest(
  request: Request,
  env: Env,
  site: SiteRecord,
  pathname: string,
): Promise<Response> {
  if (!env.SITE_DATABASE) return json({ error: 'Database is not configured' }, 503);
  const match = pathname.match(/^db\/([^/]+)(?:\/([^/]+))?$/);
  if (!match || !collectionPattern.test(match[1] || ''))
    return json({ error: 'Invalid collection' }, 400);
  const collection = match[1] as string;
  const id = match[2] ? decodeURIComponent(match[2]) : undefined;
  if (id && !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return json({ error: 'Invalid document id' }, 400);
  const target = new URL(
    `https://database.internal/collections/${encodeURIComponent(collection)}${id ? `/${encodeURIComponent(id)}` : ''}`,
  );
  target.search = new URL(request.url).search;
  const stub = env.SITE_DATABASE.get(env.SITE_DATABASE.idFromName(site.name));
  return stub.fetch(new Request(target, request));
}

async function filesRequest(
  request: Request,
  env: Env,
  site: SiteRecord,
  pathname: string,
): Promise<Response> {
  if (pathname === 'files' && request.method === 'GET') {
    const prefix = fileKey(site.name, '');
    const listed = await env.ASSETS.list({ prefix, limit: 1000 });
    return json({
      files: listed.objects.map((object) => ({
        name: object.key.slice(prefix.length),
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
        contentType: object.httpMetadata?.contentType || 'application/octet-stream',
      })),
    });
  }
  const path = siteFilePath(pathname.replace(/^files\/?/, ''));
  if (!path) return json({ error: 'Invalid file name' }, 400);
  const key = fileKey(site.name, path);
  if (request.method === 'PUT') {
    const length = Number(request.headers.get('content-length') || '0');
    if (length > MAX_FILE_BYTES) return json({ error: 'File exceeds 10 MiB' }, 413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_FILE_BYTES) return json({ error: 'File exceeds 10 MiB' }, 413);
    await env.ASSETS.put(key, bytes, {
      httpMetadata: {
        contentType: request.headers.get('content-type') || 'application/octet-stream',
      },
    });
    return json(
      { name: path, size: bytes.byteLength, url: `/_up/files/${encodeURIComponent(path)}` },
      201,
    );
  }
  if (request.method === 'GET') {
    const object = await env.ASSETS.get(key);
    if (!object) return json({ error: 'File not found' }, 404);
    const headers = new Headers(secure);
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    return new Response(object.body, { headers });
  }
  if (request.method === 'DELETE') {
    await env.ASSETS.delete(key);
    return json({ deleted: true, name: path });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function aiRequest(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return json({ error: 'AI is not configured' }, 503);
  const input = await request.json<{ messages?: unknown }>().catch(() => null);
  if (
    !input ||
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > 24
  )
    return json({ error: 'Messages must contain 1-24 entries' }, 400);
  const messages = input.messages.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid message');
    const value = item as Record<string, unknown>;
    if (
      !['user', 'assistant', 'system'].includes(String(value.role)) ||
      typeof value.content !== 'string'
    )
      throw new Error('Invalid message');
    return { role: String(value.role), content: value.content.slice(0, 8000) };
  });
  if (JSON.stringify(messages).length > MAX_AI_INPUT)
    return json({ error: 'AI input is too large' }, 413);
  try {
    const result = await env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct-fast' as keyof AiModels,
      {
        messages,
        max_tokens: 512,
      } as never,
    );
    return json(result);
  } catch {
    return json({ error: 'AI request failed' }, 502);
  }
}

async function realtimeRequest(
  request: Request,
  env: Env,
  site: SiteRecord,
  identity: Identity,
  pathname: string,
): Promise<Response> {
  if (!env.SITE_REALTIME) return json({ error: 'Realtime is not configured' }, 503);
  const channel = decodeURIComponent(pathname.slice('realtime/'.length));
  if (!channelPattern.test(channel)) return json({ error: 'Invalid channel' }, 400);
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return json({ error: 'WebSocket upgrade required' }, 426);
  const stub = env.SITE_REALTIME.get(env.SITE_REALTIME.idFromName(`${site.name}:${channel}`));
  const headers = new Headers(request.headers);
  headers.set('x-up-email', identity.email);
  headers.set('x-up-site', site.name);
  headers.set('x-up-channel', channel);
  return stub.fetch(new Request('https://realtime.internal/connect', { headers }));
}

export async function handleCapabilityRequest(
  request: Request,
  env: Env,
  site: SiteRecord,
  identity: Identity,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/_up/')) return null;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const fetchSite = request.headers.get('sec-fetch-site');
    if (origin !== url.origin || (fetchSite && fetchSite !== 'same-origin'))
      return json({ error: 'Same-origin request required' }, 403);
  }
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin)
      return json({ error: 'Same-origin request required' }, 403);
  }
  const pathname = url.pathname.slice('/_up/'.length);
  if (pathname === 'client.js' && request.method === 'GET')
    return new Response(clientModule(), {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  if (pathname === 'identity' && request.method === 'GET')
    return json({ email: identity.email, groups: identity.groups || [], role: identity.role });
  if (pathname.startsWith('db/')) return databaseRequest(request, env, site, pathname);
  if (pathname === 'files' || pathname.startsWith('files/'))
    return filesRequest(request, env, site, pathname);
  if (pathname === 'ai/chat' && request.method === 'POST') return aiRequest(request, env);
  if (pathname.startsWith('realtime/'))
    return realtimeRequest(request, env, site, identity, pathname);
  return json({ error: 'Capability not found' }, 404);
}
