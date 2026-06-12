<script lang="ts">
import { onMount } from 'svelte';

let { section = 'home', eyebrow = '' } = $props<{ section: string; eyebrow: string }>();
let files = $state<File[]>([]),
  siteName = $state(''),
  status = $state('Choose a folder containing index.html.'),
  publishing = $state(false),
  publishedUrl = $state('');
let sites = $state<Array<{ name: string; owner: string; activeDeploymentId?: string }>>([]);
const deploy = 'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/inhouse';
onMount(() => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
  if (section === 'app') loadSites();
});
async function hash(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function choose(e: Event) {
  files = Array.from((e.currentTarget as HTMLInputElement).files || []);
  status = files.length ? `${files.length} files ready.` : 'Choose a folder containing index.html.';
}
async function loadSites() {
  try {
    const r = await fetch('/api/sites'),
      d = await r.json();
    if (r.ok) sites = d.sites;
  } catch {}
}
async function publish() {
  if (!siteName || !files.length || publishing) return;
  publishing = true;
  publishedUrl = '';
  try {
    status = 'Hashing files locally…';
    const prepared = await Promise.all(
      files.map(async (file) => ({
        file,
        path: file.webkitRelativePath
          ? file.webkitRelativePath.split('/').slice(1).join('/')
          : file.name,
        sha256: await hash(file),
      })),
    );
    const manifest = prepared.map(({ file, path, sha256 }) => ({
      path,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      sha256,
    }));
    const created = await fetch(`/api/sites/${encodeURIComponent(siteName)}/deployments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest }),
      }),
      creation = await created.json();
    if (!created.ok) throw Error(creation.error);
    for (let i = 0; i < prepared.length; i++) {
      const x = prepared[i];
      if (!x) continue;
      status = `Uploading ${i + 1} of ${prepared.length}: ${x.path}`;
      const r = await fetch(
        `/api/deployments/${creation.deployment.id}/assets?path=${encodeURIComponent(x.path)}`,
        {
          method: 'PUT',
          headers: { 'content-type': x.file.type || 'application/octet-stream' },
          body: x.file,
        },
      );
      if (!r.ok) throw Error((await r.json()).error);
    }
    status = 'Verifying and activating…';
    const r = await fetch(`/api/deployments/${creation.deployment.id}/activate`, {
        method: 'POST',
      }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    publishedUrl = d.siteUrl || '';
    status = publishedUrl
      ? 'Published behind your Access boundary.'
      : 'Published. Configure SITE_DOMAIN to receive a URL.';
    await loadSites();
  } catch (e) {
    status = e instanceof Error ? e.message : 'Publish failed';
  } finally {
    publishing = false;
  }
}
</script>
<svelte:head><meta name="theme-color" content="#0b1118"><link rel="stylesheet" href="/fonts.css"></svelte:head>
<header><a class="brand" href="/"><span class="mark">IH</span><span><strong>Agent Experience</strong><em>Inhouse</em></span></a><nav><a href="/tutorial">Tutorial</a><a href="/how-to">How-to</a><a href="/reference">Reference</a><a href="/explanation">Why</a></nav><a class="source" href="https://github.com/acoyfellow/inhouse">Source ↗</a></header>
<main>
{#if section==='home'}
<p class="eyebrow">{eyebrow}</p><section class="hero"><div class="grid"></div><div class="copy"><div class="badge"><i></i> Agent Experience / Cloudflare</div><p class="prompt"><span>~/your-company</span> $ inhouse publish</p><h1>Your company’s<br><em>private web.</em></h1><p class="lede">Drop a folder of HTML, CSS, JavaScript, and assets. Get a URL that only people in your organization can open—on your Cloudflare account.</p><div class="actions"><a class="primary" href={deploy}>Deploy to Cloudflare ↘</a><a class="secondary" href="/tutorial">See how it works</a></div><div class="meta"><span>ACCESS BEFORE CONTENT</span><span>WORKER · DURABLE OBJECT · PRIVATE R2</span></div></div><div class="terminal"><div class="chrome"><span><i></i> verified deployment</span><span>inhouse · 0.0.1</span></div><pre><b>$</b> inhouse publish ./dist

Hashing 14 files locally…
Uploading immutable deployment…
Verifying Access boundary…

<b>Published quarterly-planning</b>
https://quarterly-planning.inhouse.example.com

Access: your organization
Public exposure: denied</pre></div></section><div class="cards"><article><span>01</span><h2>Install once</h2><p>Configure the hostname and identity boundary once. Employees publish without rebuilding infrastructure.</p></article><article><span>02</span><h2>Private by default</h2><p>No public R2 objects, preview URLs, or bearer links. A URL is not authorization.</p></article><article><span>03</span><h2>Made for agents</h2><p>If an agent produces a static folder, it can target Inhouse. Identity stays with the organization.</p></article></div>
{:else if section==='app'}
<article class="doc"><div class="badge"><i></i> Authenticated control plane</div><h1>Publish inhouse.</h1><p class="summary">Files remain pending until every manifest digest is verified. Activation swaps the complete deployment atomically.</p><section class="publisher"><label>Site name<input bind:value={siteName} pattern="[a-z0-9-]+" placeholder="quarterly-planning"></label><label>Static site folder<input type="file" webkitdirectory multiple onchange={choose}></label><button onclick={publish} disabled={publishing||!files.length||!siteName}>{publishing?'Publishing…':'Publish privately'}</button><p role="status">{status}</p>{#if publishedUrl}<a class="receipt" href={publishedUrl} target="_blank" rel="noopener noreferrer">{publishedUrl} ↗</a>{/if}</section><h2>Sites in this installation</h2>{#if sites.length}<div class="site-list">{#each sites as site}<div><strong>{site.name}</strong><span>{site.owner}</span><small>{site.activeDeploymentId?'active':'pending'}</small></div>{/each}</div>{:else}<p>No sites yet.</p>{/if}</article>
{:else if section==='tutorial'}
<article class="doc"><h1>Deploy Inhouse</h1><p class="summary">Create the resources, attach a private hostname, then prove unauthenticated requests cannot reach content.</p><h2>1. Create the resources</h2><p><a class="primary" href={deploy}>Deploy to Cloudflare</a></p><p>The button creates a Worker, SQLite-backed Durable Object, and private R2 bucket. Until Access is configured, control and site requests fail closed.</p><h2>2. Attach hostnames</h2><pre><code>CONTROL_HOST=inhouse.example.com
SITE_DOMAIN=inhouse.example.com

inhouse.example.com
*.inhouse.example.com</code></pre><h2>3. Protect both hostnames</h2><p>Create a wildcard Cloudflare Access application covering the control hostname and site wildcard. Set <code>TEAM_DOMAIN</code> and <code>POLICY_AUD</code>. Disable <code>workers.dev</code> for production.</p><h2>4. Publish and verify</h2><p>Open <code>/app</code>, publish a folder, then open the result in both an authenticated browser and an isolated browser. The isolated browser must reach Access—not uploaded content.</p></article>
{:else if section==='how-to'}
<article class="doc"><h1>How-to guides</h1><p class="summary">Operate Inhouse without weakening its trust boundary.</p><h2>Update a site</h2><p>Publish the same name. Inhouse switches the active pointer only after every new object passes its manifest digest.</p><h2>Grant administrators</h2><p>Set <code>ADMIN_EMAILS</code>. Creators manage their own sites; company members read through Access.</p><h2>Use a coding agent</h2><pre><code>Build a static site into ./dist. Keep secrets out of browser code.
Ask me to open Inhouse and publish ./dist when ready.
Return the company-private URL and deployment receipt.</code></pre><h2>Respond to an incident</h2><p>Disable the wildcard route or Access policy before investigating. Never enable <code>workers.dev</code> as a workaround.</p></article>
{:else if section==='reference'}
<article class="doc"><h1>Reference</h1><p class="summary">Exact routes and limits for version 0.0.1.</p><table><tbody><tr><th><code>GET /app</code></th><td>Access-authenticated publisher.</td></tr><tr><th><code>GET /api/sites</code></th><td>List installation sites.</td></tr><tr><th><code>POST /api/sites/:name/deployments</code></th><td>Create pending deployment.</td></tr><tr><th><code>PUT /api/deployments/:id/assets</code></th><td>Digest-check one asset.</td></tr><tr><th><code>POST /api/deployments/:id/activate</code></th><td>Verify and activate.</td></tr><tr><th><code>GET /__inhouse/me</code></th><td>Validated viewer identity.</td></tr></tbody></table><h2>Defaults</h2><ul><li>500 files</li><li>10 MiB per file</li><li>50 MiB total</li><li><code>index.html</code> required</li></ul></article>
{:else if section==='explanation'}
<article class="doc"><h1>The trust boundary is the product.</h1><p class="summary">Building a small site is easier than sharing it safely inside a company.</p><h2>One installation, many sites</h2><p>A wildcard Access application protects the publishing plane once. Every site inherits organization identity.</p><h2>Control and content differ</h2><p>The control API accepts mutations only from its exact origin. Generated code runs on sibling hostnames and receives no Cloudflare bindings or secrets.</p><h2>Identifiers are not credentials</h2><p>Site names, deployment IDs, object keys, and URLs grant nothing. Every read requires Access; every mutation checks ownership.</p><h2>No public interval</h2><p>Content stays pending in private R2 until verified. Production routes are attached only after Access exists.</p></article>
{:else if section==='offline'}<article class="doc"><h1>You are offline.</h1><p class="summary">The docs shell is cached. Publishing still requires Access.</p></article>
{:else}<article class="doc"><h1>That page is not inhouse.</h1><p class="summary">The documentation may have moved.</p><a class="secondary" href="/">Return home</a></article>{/if}
</main><footer><span>Cloudflare / Agent Experience</span><span>INHOUSE · MIT · 0.0.1</span><a href="https://coey.dev">coey.dev ↗</a></footer>
<style>
:global(:root){color-scheme:dark;--sans:Inter,system-ui,sans-serif;--mono:"IBM Plex Mono",monospace;--ink:#0b1118;--layer:#111a24;--layer2:#182431;--text:#f7f9fb;--muted:#9baaba;--border:#aec4d824;--strong:#aec4d845;--orange:#f6821f;--blue:#71b8d8;--green:#63d5a2}:global(*){box-sizing:border-box}:global(body){min-width:320px;margin:0;background:var(--ink);color:var(--text);font-family:var(--sans)}:global(a){color:inherit}:global(code),pre{font-family:var(--mono)}header,footer,main{width:min(100%,1280px);margin:auto;padding-inline:28px}header{height:76px;display:flex;align-items:center;gap:30px;border-bottom:1px solid var(--border)}.brand{display:flex;align-items:center;gap:.7rem;text-decoration:none}.mark{display:grid;place-items:center;width:2.3rem;height:2.3rem;border-radius:50%;color:#210c00;background:radial-gradient(circle at 30% 20%,white,var(--blue) 40%,var(--orange) 75%);font:700 .65rem var(--mono)}.brand>span:last-child{display:grid;line-height:1}.brand strong{font-size:.9rem}.brand em{margin-top:.28rem;color:var(--muted);font:400 .66rem var(--mono);font-style:normal}header nav{display:flex;gap:22px;margin-left:auto}header nav a,.source{color:var(--muted);font:500 .65rem var(--mono);text-decoration:none;text-transform:uppercase}.source{padding:.65rem .75rem;border:1px solid var(--strong);border-radius:.45rem}main{padding-block:70px 110px}.eyebrow{color:var(--orange);font:600 .66rem var(--mono);letter-spacing:.1em;text-transform:uppercase}.hero{position:relative;display:grid;grid-template-columns:1.08fr .92fr;gap:5vw;align-items:center;min-height:550px;padding:clamp(30px,5vw,68px);border:1px solid var(--border);border-radius:.7rem;overflow:hidden;background:linear-gradient(110deg,#080d13fc,#0d1f2be8)}.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff0c 1px,transparent 1px),linear-gradient(90deg,#ffffff0c 1px,transparent 1px);background-size:4rem 4rem}.copy,.terminal{position:relative}.badge{display:inline-flex;gap:.5rem;align-items:center;padding:.42rem .58rem;border:1px solid var(--strong);border-radius:999px;font:600 .58rem var(--mono);text-transform:uppercase}.badge i,.chrome i{width:.42rem;height:.42rem;border-radius:50%;background:var(--orange)}.prompt{margin:2rem 0 .8rem;color:var(--muted);font:500 .68rem var(--mono)}.prompt span{color:var(--blue)}h1{margin:0 0 1.25rem;font:500 clamp(2.8rem,5.5vw,5.5rem)/.96 var(--mono);letter-spacing:-.07em}h1 em{color:var(--blue);font-style:normal}.lede,.summary{max-width:650px;color:#c8d4dd;font-size:clamp(1rem,1.6vw,1.18rem);line-height:1.65}.actions{display:flex;gap:.65rem;margin-top:2rem}.primary,.secondary,button{display:inline-flex;justify-content:center;align-items:center;min-height:2.7rem;padding:0 1rem;border-radius:.45rem;font-size:.76rem;font-weight:700;text-decoration:none}.primary,button{border:1px solid var(--orange);background:var(--orange);color:#210c00}.secondary{border:1px solid var(--strong);background:var(--layer2)}.meta{display:flex;gap:1.2rem;margin-top:2rem;color:var(--muted);font:500 .54rem var(--mono)}.meta span:first-child{color:var(--orange)}.terminal{border:1px solid var(--strong);border-radius:.7rem;background:#080d13;box-shadow:0 32px 100px #0007;overflow:hidden}.chrome{height:42px;display:flex;justify-content:space-between;align-items:center;padding:0 .85rem;border-bottom:1px solid var(--border);color:var(--muted);font:500 .56rem var(--mono)}.chrome span:first-child{display:flex;gap:.45rem;align-items:center}.chrome i{background:var(--green)}.terminal pre{min-height:330px;margin:0;padding:1.5rem;color:#d7e2ec;font-size:.72rem;line-height:1.7}.terminal b{color:var(--orange)}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:1rem;border:1px solid var(--border);border-radius:.7rem;background:var(--border);overflow:hidden}.cards article{min-height:230px;padding:1.35rem;background:var(--layer)}.cards span{color:var(--orange);font:600 .6rem var(--mono)}.cards h2{margin:4rem 0 .6rem}.cards p,.doc p,.doc li{color:var(--muted);font-size:.84rem;line-height:1.72}.doc{max-width:960px}.doc h1{font-size:clamp(3rem,6vw,5.5rem)}.doc h2{margin-top:3rem}.doc pre{padding:1.15rem;border:1px solid var(--border);border-radius:.7rem;background:#080d13;overflow:auto}.doc table{width:100%;border-collapse:collapse}.doc th,.doc td{padding:1rem .65rem;border-bottom:1px solid var(--border);text-align:left}.doc th{width:290px}.doc td{color:var(--muted)}.publisher{display:grid;gap:1rem;margin:2rem 0;padding:1.3rem;border:1px solid var(--strong);border-radius:.7rem;background:var(--layer)}.publisher label{display:grid;gap:.45rem;color:var(--muted);font:600 .68rem var(--mono)}.publisher input{padding:.8rem;border:1px solid var(--strong);border-radius:.4rem;background:var(--ink);color:var(--text)}button{width:max-content;cursor:pointer}button:disabled{opacity:.45}.receipt{padding:.8rem;border:1px solid #63d5a255;border-radius:.4rem;color:var(--green);font-family:var(--mono)}.site-list{border:1px solid var(--border);border-radius:.7rem}.site-list div{display:grid;grid-template-columns:1fr 1.2fr auto;gap:1rem;padding:1rem;border-bottom:1px solid var(--border)}.site-list span,.site-list small{color:var(--muted);font-size:.72rem}footer{display:grid;grid-template-columns:1fr auto auto;gap:2rem;padding-block:1.7rem 3rem;border-top:1px solid var(--border);color:var(--muted);font:500 .58rem var(--mono)}footer a{color:var(--blue)}@media(max-width:900px){header nav{display:none}.source{margin-left:auto}.hero{grid-template-columns:1fr}.cards{grid-template-columns:1fr}.cards article{min-height:170px}.cards h2{margin-top:2rem}}@media(max-width:600px){header{padding-inline:18px}.brand em{display:none}main{padding:42px 18px 80px}.hero{padding:26px 20px}h1{font-size:3rem}.actions{flex-direction:column}.terminal pre{font-size:.58rem}.meta{display:grid}.site-list div{grid-template-columns:1fr}footer{grid-template-columns:1fr;padding-inline:18px}}
</style>