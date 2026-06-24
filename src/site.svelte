<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import UpLogo from './lib/UpLogo.svelte';
  import UpMark from './lib/UpMark.svelte';

  type Site = {
    name: string;
    owner: string;
    updatedAt?: string;
    activeDeploymentId?: string;
  };

  type PreparedFile = {
    file: File;
    path: string;
    sha256: string;
  };

  type ErrorPayload = { error?: string };
  type SitesPayload = { sites: Site[]; siteDomain?: string | null };
  type IdentityPayload = { email: string };
  type DeploymentPayload = { deployment: { id: string }; error?: string };
  type ActivationPayload = { siteUrl?: string; error?: string };

  function responseJson<T>(response: Response): Promise<T> {
    return response.json() as Promise<T>;
  }

  let {
    section = 'home',
    eyebrow = '',
    initialIdentity = '',
    initialSites = [],
    initialSiteDomain = 'up.example.com',
    productLoaded = false,
  } = $props<{
    section: string;
    eyebrow: string;
    initialIdentity?: string;
    initialSites?: Site[];
    initialSiteDomain?: string;
    productLoaded?: boolean;
  }>();

  let files = $state<File[]>([]);
  let prepared = $state<PreparedFile[]>([]);
  let siteName = $state('');
  let status = $state('');
  let progress = $state(0);
  let publishing = $state(false);
  let publishedUrl = $state('');
  let sites = $state<Site[]>(untrack(() => initialSites));
  let identity = $state(untrack(() => initialIdentity));
  let siteDomain = $state(untrack(() => initialSiteDomain));
  let dragging = $state(false);
  let copied = $state(false);
  let workerName = $state('my-app');
  let workerCode = $state(`export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/hello') {
      return Response.json({ hello: 'world' });
    }

    return env.ASSETS.fetch(request);
  }
};`);
  let workerBindings = $state({ kv: false, d1: false, durableObjects: false });
  let workerSaved = $state(false);
  let workerPublicConsent = $state(false);
  let workerTermsConsent = $state(false);
  let bridgeStatus = $state<'checking' | 'offline' | 'ready' | 'deploying' | 'live' | 'error'>(
    'checking',
  );
  let bridgeMessage = $state('Checking local Up bridge…');
  let workerLiveUrl = $state('');
  let view = $state<'empty' | 'worker' | 'selected' | 'publishing' | 'success' | 'list'>(
    untrack(() => initialSites.length) ? 'list' : 'empty',
  );
  let input = $state<HTMLInputElement>();
  let siteNameInput = $state<HTMLInputElement>();

  const deployUrl =
    'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/up';
  const nativeCatalog = [
    { name: 'Worker', slug: 'workers', action: 'Run code', status: 'Included in Up', detail: 'Dynamic request handling at a public workers.dev URL.' },
    { name: 'Static Assets', slug: 'assets', action: 'Serve the page', status: 'Included in Up', detail: 'HTML, CSS, JavaScript, images, and other browser files.' },
    { name: 'KV', slug: 'kv', action: 'Store keys', status: 'Included in Up', detail: 'Fast key-value reads and writes, provisioned from up.json.' },
    { name: 'D1', slug: 'd1', action: 'Query SQL', status: 'Included in Up', detail: 'A SQLite database that stays with the app if you keep it.' },
    { name: 'Durable Objects', slug: 'durableObjects', action: 'Coordinate state', status: 'Included in Up', detail: 'Storage, coordination, and WebSockets with SQLite migrations.' },
    { name: 'Queues', slug: 'queues', action: 'Process work later', status: 'Temporary Account ready', detail: 'Supported upstream; Up’s up.json wiring is next.' },
    { name: 'Hyperdrive', slug: 'hyperdrive', action: 'Reach an existing database', status: 'Temporary Account ready', detail: 'Supported upstream; requires a database connection policy.' },
    { name: 'Certificates', slug: 'certificates', action: 'Use client certificates', status: 'Account operation', detail: 'Supported by Temporary Accounts; configured outside the app manifest.' },
  ];
  const capaCatalog = [
    { name: 'GitHub', slug: 'github' },
    { name: 'GitLab', slug: 'gitlab' },
    { name: 'Jira', slug: 'jira' },
    { name: 'Slack', slug: 'slack' },
    { name: 'Stripe', slug: 'stripe' },
    { name: 'Discord', slug: 'discord' },
    { name: 'Box', slug: 'box' },
    { name: 'Kubernetes', slug: 'kubernetes' },
    { name: 'Sentry', slug: 'sentry' },
    { name: 'Twilio', slug: 'twilio' },
    { name: 'Twilio Messaging', slug: 'twilio' },
    { name: 'Twilio Verify', slug: 'twilio' },
    { name: 'Twitch', slug: 'twitch' },
    { name: 'Zoom', slug: 'zoom' },
  ];
  const isProduct = $derived(section === 'app');

  onMount(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
    // SvelteKit supplies authoritative product data in the initial SSR payload.
    // The fallback keeps the legacy renderer functional during migration only.
    if (isProduct && !productLoaded) void initializeProduct();
    if (isProduct) void checkBridge();
  });

  async function initializeProduct() {
    await Promise.all([loadSites(), loadIdentity()]);
    view = sites.length ? 'list' : 'empty';
  }

  async function loadIdentity() {
    try {
      const response = await fetch('/api/me');
      const data = await responseJson<IdentityPayload>(response);
      if (response.ok) identity = data.email;
    } catch {
      identity = '';
    }
  }

  async function loadSites() {
    try {
      const response = await fetch('/api/sites');
      const data = await responseJson<SitesPayload>(response);
      if (response.ok) {
        sites = data.sites;
        if (data.siteDomain) siteDomain = data.siteDomain;
      }
    } catch {
      sites = [];
    }
  }

  function chooseFolder() {
    input?.click();
  }

  function startWorker() {
    workerSaved = false;
    workerLiveUrl = '';
    view = 'worker';
    void checkBridge();
  }

  async function checkBridge() {
    bridgeStatus = 'checking';
    bridgeMessage = 'Checking local Up bridge…';
    try {
      const response = await fetch('http://127.0.0.1:8797/health', { signal: AbortSignal.timeout(1800) });
      if (!response.ok) throw new Error('bridge unavailable');
      bridgeStatus = 'ready';
      bridgeMessage = 'Local Up bridge connected.';
    } catch {
      bridgeStatus = 'offline';
      bridgeMessage = 'Run `bunx github:acoyfellow/up bridge`, then reconnect.';
    }
  }

  async function deployWorkerFromWorkspace() {
    if (!workerPublicConsent || !workerTermsConsent || bridgeStatus !== 'ready') return;
    bridgeStatus = 'deploying';
    bridgeMessage = 'Wrangler is creating the temporary app…';
    workerLiveUrl = '';
    try {
      const response = await fetch('http://127.0.0.1:8797/deploy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: workerName,
          code: workerCode,
          bindings: workerBindings,
          acceptPublic: workerPublicConsent,
          acceptTerms: workerTermsConsent,
        }),
      });
      const result = (await response.json()) as { liveUrl?: string; error?: string };
      if (!response.ok || !result.liveUrl) throw new Error(result.error || 'Deployment failed');
      workerLiveUrl = result.liveUrl;
      workerSaved = true;
      bridgeStatus = 'live';
      bridgeMessage = 'Temporary app is live.';
    } catch (error) {
      bridgeStatus = 'error';
      bridgeMessage = error instanceof Error ? error.message : 'Deployment failed';
    }
  }

  function workerManifest() {
    return {
      bindings: {
        ...(workerBindings.kv ? { kv: ['CACHE'] } : {}),
        ...(workerBindings.d1 ? { d1: ['DB'] } : {}),
        ...(workerBindings.durableObjects
          ? { durableObjects: [{ binding: 'ROOMS', className: 'Room' }] }
          : {}),
      },
    };
  }

  function downloadFile(path: string, content: string, type: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = `${workerName}-${path.replaceAll('/', '-')}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function saveWorkerProject() {
    const safeName = normalizeName(workerName) || 'my-app';
    workerName = safeName;
    const generatedWorker =
      workerBindings.durableObjects && !/export\s+class\s+Room\b/.test(workerCode)
        ? `${workerCode}\n\nexport class Room {\n  constructor(state) { this.state = state; }\n  async fetch() { return Response.json({ ok: true }); }\n}\n`
        : workerCode;
    const files = {
      'worker/index.js': generatedWorker,
      'public/index.html': '<!doctype html><title>My Up app</title><main><h1>It works.</h1></main>',
      'up.json': `${JSON.stringify(workerManifest(), null, 2)}\n`,
    };
    const picker = (
      window as unknown as {
        showDirectoryPicker?: () => Promise<{
          getDirectoryHandle(name: string, options: { create: true }): Promise<unknown>;
          getFileHandle(name: string, options: { create: true }): Promise<{
            createWritable(): Promise<{ write(value: string): Promise<void>; close(): Promise<void> }>;
          }>;
        }>;
      }
    ).showDirectoryPicker;
    if (picker) {
      const root = await picker();
      const app = (await root.getDirectoryHandle(safeName, { create: true })) as Awaited<
        ReturnType<NonNullable<typeof picker>>
      >;
      for (const [path, content] of Object.entries(files)) {
        const parts = path.split('/');
        let directory = app;
        while (parts.length > 1) {
          directory = (await directory.getDirectoryHandle(parts.shift() as string, {
            create: true,
          })) as typeof app;
        }
        const handle = await directory.getFileHandle(parts[0] as string, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      }
    } else {
      const encode = (value: string) => {
        const bytes = new TextEncoder().encode(value);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      };
      const script = `#!/bin/sh\nset -eu\nmkdir -p '${safeName}/public' '${safeName}/worker'\nprintf %s '${encode(files['public/index.html'])}' | base64 -d > '${safeName}/public/index.html'\nprintf %s '${encode(files['worker/index.js'])}' | base64 -d > '${safeName}/worker/index.js'\nprintf %s '${encode(files['up.json'])}' | base64 -d > '${safeName}/up.json'\necho 'Created ${safeName}'\n`;
      downloadFile(`create-${safeName}.sh`, script, 'text/x-shellscript');
    }
    workerSaved = true;
  }

  async function copyWorkerCommand() {
    await navigator.clipboard.writeText(`bunx github:acoyfellow/up open ./${workerName}`);
    copied = true;
    setTimeout(() => (copied = false), 1800);
  }

  function acceptInput(event: Event) {
    const element = event.currentTarget as HTMLInputElement;
    void acceptFiles(Array.from(element.files || []));
  }

  function folderName(fileList: File[]): string {
    const first = fileList.find((file) => file.webkitRelativePath)?.webkitRelativePath;
    return first?.split('/')[0] || 'internal-site';
  }

  function normalizeName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  }

  function relativePath(file: File): string {
    return file.webkitRelativePath
      ? file.webkitRelativePath.split('/').slice(1).join('/')
      : file.name;
  }

  async function digest(file: File): Promise<string> {
    const value = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(value)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function acceptFiles(fileList: File[]) {
    if (!fileList.length) return;
    files = fileList;
    siteName = normalizeName(folderName(fileList));
    publishedUrl = '';
    status = 'Preparing files';
    view = 'selected';
    prepared = await Promise.all(
      fileList.map(async (file) => ({ file, path: relativePath(file), sha256: await digest(file) })),
    );
    status = prepared.some((asset) => asset.path === 'index.html')
      ? 'Ready to publish'
      : 'index.html is required';
    requestAnimationFrame(() => siteNameInput?.focus());
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    void acceptFiles(Array.from(event.dataTransfer?.files || []));
  }

  function reset() {
    files = [];
    prepared = [];
    siteName = '';
    status = '';
    progress = 0;
    publishing = false;
    publishedUrl = '';
    copied = false;
    if (input) input.value = '';
    view = isProduct && sites.length ? 'list' : 'empty';
    workerSaved = false;
  }

  const totalBytes = $derived(files.reduce((sum, file) => sum + file.size, 0));
  const hasIndex = $derived(prepared.some((asset) => asset.path === 'index.html'));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function publish() {
    if (!isProduct || !siteName || !prepared.length || !hasIndex || publishing) return;
    publishing = true;
    view = 'publishing';
    progress = 5;
    try {
      const manifest = prepared.map(({ file, path, sha256 }) => ({
        path,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
        sha256,
      }));
      status = 'Creating deployment';
      const created = await fetch(`/api/sites/${encodeURIComponent(siteName)}/deployments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          manifest,
          access: { visibility: 'company', readers: [] },
        }),
      });
      const creation = await responseJson<DeploymentPayload>(created);
      if (!created.ok) throw new Error(creation.error || 'Unable to create deployment');

      for (let index = 0; index < prepared.length; index++) {
        const asset = prepared[index];
        if (!asset) continue;
        status = `Uploading ${index + 1} of ${prepared.length}`;
        progress = 10 + Math.round(((index + 1) / prepared.length) * 75);
        const response = await fetch(
          `/api/deployments/${creation.deployment.id}/assets?path=${encodeURIComponent(asset.path)}`,
          {
            method: 'PUT',
            headers: { 'content-type': asset.file.type || 'application/octet-stream' },
            body: asset.file,
          },
        );
        if (!response.ok)
          throw new Error((await responseJson<ErrorPayload>(response)).error || 'Upload failed');
      }

      status = 'Verifying deployment';
      progress = 90;
      const activated = await fetch(`/api/deployments/${creation.deployment.id}/activate`, {
        method: 'POST',
      });
      const result = await responseJson<ActivationPayload>(activated);
      if (!activated.ok) throw new Error(result.error || 'Activation failed');
      publishedUrl = result.siteUrl || '';
      progress = 100;
      status = 'Published';
      view = 'success';
      await loadSites();
    } catch (error) {
      status = error instanceof Error ? error.message : 'Publishing failed';
      view = 'selected';
    } finally {
      publishing = false;
    }
  }

  async function copyLink() {
    if (!publishedUrl) return;
    await navigator.clipboard.writeText(publishedUrl);
    copied = true;
    setTimeout(() => (copied = false), 1800);
  }
</script>

<svelte:head>
  <meta name="theme-color" content="#ffffff" />
  <link rel="stylesheet" href="/fonts.css" />
</svelte:head>

<header class:product={isProduct}>
  <a class="wordmark" href="/" aria-label="Up home"><UpLogo decorative /></a>
  <nav aria-label="Primary">
    {#if !isProduct}
      <a href="/tutorial">Docs</a>
      <a href="/explanation">How it works</a>
      <a href="https://github.com/acoyfellow/up">Get the CLI ↗</a>
    {:else}
      <a href="/tutorial">Docs</a>
      <a href="https://github.com/acoyfellow/up">Source ↗</a>
      <span class="identity"><i aria-hidden="true"></i>{identity}</span>
    {/if}
  </nav>
</header>

<main class:product={isProduct} class:home={section === 'home'}>
  {#if section === 'home'}
    <div class="home-shell">
      <section class="home-hero" aria-labelledby="home-title">
        <div class="home-hero-copy">
          <div class="home-kicker"><span>Deploy without an account</span></div>
          <h1 id="home-title">Your app is live<br /><span class="accent">before you sign up.</span></h1>
          <p class="home-tagline">Worker code, browser assets, KV, D1, and Durable Objects—running together on Cloudflare for about an hour. Keep the whole thing, or let it disappear.</p>
          <div class="home-actions">
            <a class="primary link-button" href="https://github.com/acoyfellow/up#deploy-first">Get the CLI <span aria-hidden="true">→</span></a>
            <a class="home-secondary" href="/tutorial">See it work</a>
          </div>
          <p class="hosted-note caution"><i aria-hidden="true"></i>The URL is public. Anyone with it can load your app — don&rsquo;t deploy secrets.</p>
          <p class="hosted-note"><i aria-hidden="true"></i>Independent project. Not an official Cloudflare product.</p>
        </div>
        <picture class="home-art" aria-hidden="true">
          <source srcset="/images/up-hero-paint.webp" type="image/webp" />
          <img src="/images/up-hero-paint.jpg" alt="" width="1536" height="1024" fetchpriority="high" />
        </picture>
        <div class="ambient-mark" aria-hidden="true">
          <UpMark size={360} />
        </div>
        <div class="paint-pattern" aria-hidden="true">
          {#each Array(8) as _, index}
            <UpMark
              size={42}
              primary={index % 2 ? '#ffffff' : '#71b8d8'}
              satellite={index % 2 ? '#71b8d8' : '#ffffff'}
            />
          {/each}
        </div>
      </section>

      <section class="shelf" aria-labelledby="shelf-title">
        <div class="shelf-head">
          <p class="section-index">01 / DYNAMIC</p>
          <h2 id="shelf-title">Bindings off the shelf.</h2>
          <p>Up wires Worker, Static Assets, KV, D1, and Durable Objects now. Temporary Accounts also support Queues, Hyperdrive, and certificates; the catalog below shows what works in Up today and what the platform is ready for next.</p>
        </div>
        <p class="catalog-label native-label">In Temporary Accounts today · 8 primitives</p>
        <div class="feature-grid" aria-label="Cloudflare primitives available in Temporary Accounts">
          {#each nativeCatalog as product}
            <article class:pending={product.status !== 'Included in Up'}>
              <div class="native-title">
                <img src={`/images/cloudflare/${product.slug}.svg`} alt="" width="30" height="30" />
                <span>{product.name}</span>
              </div>
              <small>{product.status}</small>
              <h3>{product.action}</h3>
              <p>{product.detail}</p>
            </article>
          {/each}
        </div>
        <div class="connected-services">
          <div>
            <p class="section-index">CONNECTED SERVICES / CAPA</p>
            <h3>Connect GitHub, Stripe, and the tools your app needs.</h3>
            <p class="connected-copy">Capa keeps API keys out of your app code. You choose what the app is allowed to do; each request comes back with the answer and a clear record of what happened.</p>
            <p class="catalog-label">In Capa today · 14 bindings</p>
            <ul class="capa-catalog" aria-label="Services available in Capa today">
              {#each capaCatalog as service}
                <li>
                  <img src={`/images/capa/${service.slug}.svg`} alt="" width="24" height="24" />
                  <span>{service.name}</span>
                </li>
              {/each}
            </ul>
          </div>
          <div class="connected-status">
            <strong>Tested end to end</strong>
            <span>The connection worked in a real temporary account. The simple installer is not shipped yet.</span>
            <a href="https://capa.coey.dev">See Capa <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <div class="after-keep">
          <strong>If you keep it</strong>
          <span>The Worker, bindings, and data stay together in your Cloudflare account. The app is still public until you add Cloudflare Access or another login.</span>
        </div>
        <a class="shelf-cta primary link-button" href="/tutorial">Deploy one in a minute <span aria-hidden="true">→</span></a>
      </section>
    </div>
  {:else if section === 'app'}
    <section class="workspace" aria-label="Private Up workspace">
      {#if view === 'empty'}
        <div
          class:dragging
          class="empty-state"
          role="region"
          aria-label="Folder drop area"
          ondragover={(event) => {
            event.preventDefault();
            dragging = true;
          }}
          ondragleave={() => (dragging = false)}
          ondrop={drop}
        >
          <div class="empty-copy">
            <p class="state-label">Workspace</p>
            <h1>Start with a folder<br />or a Worker.</h1>
            <p>Drop a project anywhere in this workspace, or write a dynamic Worker here and choose its bindings.</p>
            <div class="workspace-choices">
              <button class="workspace-choice" onclick={chooseFolder}>
                <span class="choice-icon" aria-hidden="true">↥</span>
                <strong>Drop a folder</strong>
                <small>Publish files behind this instance&rsquo;s Access policy</small>
              </button>
              <button class="workspace-choice" onclick={startWorker}>
                <span class="choice-icon code" aria-hidden="true">&#123; &#125;</span>
                <strong>New Worker</strong>
                <small>Write code, add bindings, then deploy with local Up</small>
              </button>
            </div>
            <small class="access-note"><i aria-hidden="true"></i> Protected by Cloudflare Access · {identity}</small>
          </div>
        </div>
      {:else if view === 'worker'}
        <div class="worker-builder">
          <div class="builder-head">
            <div><p class="state-label">New Worker</p><h1>Build the app.</h1></div>
            <button class="text-button" onclick={reset}>Close</button>
          </div>
          <div class="builder-grid">
            <section class="editor-panel">
              <label class="worker-name"><span>Project name</span><input bind:value={workerName} aria-label="Project name" /></label>
              <label class="code-editor"><span>worker/index.js</span><textarea bind:value={workerCode} spellcheck="false" aria-label="Worker code"></textarea></label>
            </section>
            <aside class="binding-panel">
              <p class="state-label">Bindings</p>
              <label><input type="checkbox" bind:checked={workerBindings.kv} /><span><strong>KV</strong><small>Fast key-value storage</small></span></label>
              <label><input type="checkbox" bind:checked={workerBindings.d1} /><span><strong>D1</strong><small>SQLite database</small></span></label>
              <label><input type="checkbox" bind:checked={workerBindings.durableObjects} /><span><strong>Durable Objects</strong><small>Coordinated state and WebSockets</small></span></label>
              <div class="builder-boundary" class:connected={bridgeStatus === 'ready' || bridgeStatus === 'live'}><strong>Local Wrangler bridge</strong><p>{bridgeMessage}</p>{#if bridgeStatus === 'offline' || bridgeStatus === 'error'}<button class="text-button" onclick={checkBridge}>Reconnect</button><code>bunx github:acoyfellow/up bridge</code>{/if}</div>
              <fieldset class="worker-consent"><legend>Before deployment</legend><label><input type="checkbox" bind:checked={workerPublicConsent} /> This app and API may be public for about an hour.</label><label><input type="checkbox" bind:checked={workerTermsConsent} /> I accept Cloudflare&rsquo;s Terms and Privacy Policy.</label></fieldset>
            </aside>
          </div>
          <div class="builder-actions">
            <button class="secondary" onclick={saveWorkerProject}>Save project</button>
            <button class="secondary" onclick={copyWorkerCommand} disabled={!workerSaved}>{copied ? 'Command copied' : 'Copy local command'}</button>
            <button class="primary" onclick={deployWorkerFromWorkspace} disabled={bridgeStatus !== 'ready' || !workerPublicConsent || !workerTermsConsent}>Deploy Worker</button>
          </div>
          {#if workerLiveUrl}<p class="builder-status live" role="status">Live: <a href={workerLiveUrl} target="_blank" rel="noopener noreferrer">{workerLiveUrl}</a></p>{:else if workerSaved}<p class="builder-status" role="status">Project saved. You can continue with <code>bunx github:acoyfellow/up open ./{workerName}</code>.</p>{/if}
        </div>
      {:else if view === 'list'}
        <div class="list-view">
          <div class="view-heading">
            <div><p class="state-label">Private Up</p><h1>Deployments</h1></div>
            <button class="primary small" onclick={chooseFolder}>New private site</button>
          </div>
          <div class="site-list">
            {#each sites as site}
              <article>
                <div><strong>{site.name}</strong><a href={`https://${site.name}.${siteDomain}`} target="_blank" rel="noopener noreferrer"><code>{site.name}.{siteDomain}</code></a></div>
                <div><span>{site.owner}</span><small>Access protected · {site.activeDeploymentId ? 'Live' : 'Pending'}</small></div>
              </article>
            {/each}
          </div>
        </div>
      {:else if view === 'selected'}
        <div class="selected-view">
          <button class="back" onclick={reset}>← Back</button>
          <p class="state-label">Name your site</p>
          <h1>{folderName(files)}/</h1>
          <dl class="file-summary">
            <div><dt>Files</dt><dd>{files.length}</dd></div>
            <div><dt>Size</dt><dd>{formatBytes(totalBytes)}</dd></div>
            <div><dt>Entry point</dt><dd class:valid={hasIndex} role={hasIndex ? 'status' : 'alert'}>{hasIndex ? 'index.html found' : 'Missing index.html'}</dd></div>
          </dl>
          <label class="address">
            <span>Site address</span>
            <div><input bind:this={siteNameInput} bind:value={siteName} aria-label="Site name" aria-describedby="site-address-help" /><em>.{siteDomain}</em></div>
            <small id="site-address-help">Lowercase letters, numbers, and hyphens. This becomes your private company URL.</small>
          </label>
          <p class="privacy"><i></i> Anyone authenticated by your organization can open this site.</p>
          <div class="footer-actions">
            <button class="secondary" onclick={reset}>Cancel</button>
            {#if isProduct}
              <button class="primary" onclick={publish} disabled={!hasIndex || !siteName}>{status === 'Ready to publish' ? 'Publish site' : status}</button>
            {:else}
              <a class="primary link-button" href={deployUrl}>Deploy Up</a>
            {/if}
          </div>
        </div>
      {:else if view === 'publishing'}
        <div class="publishing-view" aria-live="polite">
          <p class="state-label">Publishing</p>
          <h1>{siteName}</h1>
          <div class="steps">
            <div><span>Preparing files</span><b>Complete</b></div>
            <div><span>Uploading files</span><b>{status.startsWith('Uploading') ? status.replace('Uploading ', '') : 'Complete'}</b></div>
            <div><span>Verifying deployment</span><b>{progress >= 90 ? 'In progress' : 'Waiting'}</b></div>
            <div><span>Publishing</span><b>{progress === 100 ? 'Complete' : 'Waiting'}</b></div>
          </div>
          <div class="progress" role="progressbar" aria-label="Publishing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><i style={`width:${progress}%`}></i></div>
          <p class="progress-number">{progress}%</p>
          <small>Your current site remains unchanged until publishing completes.</small>
        </div>
      {:else if view === 'success'}
        <div class="success-view" role="status" aria-live="polite">
          <p class="state-label success">Published securely</p>
          <h1>Published.</h1>
          <a class="published-url" href={publishedUrl} target="_blank" rel="noopener noreferrer">{publishedUrl}</a>
          <div class="success-actions"><button class="secondary" onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button><a class="text-link" href={publishedUrl} target="_blank" rel="noopener noreferrer">Open site ↗</a></div>
          <dl class="receipt"><div><dt>Access</dt><dd>Your organization</dd></div><div><dt>Published by</dt><dd>{identity}</dd></div><div><dt>Files</dt><dd>{files.length}</dd></div></dl>
          <button class="text-button" onclick={reset}>Publish another</button>
        </div>
      {/if}
      <input bind:this={input} class="file-input" type="file" webkitdirectory multiple aria-label="Choose a static site folder" onchange={acceptInput} />
    </section>
  {:else}
    <div class="docs-shell">
      <aside class="docs-nav" aria-label="Documentation">
        <p>Documentation</p>
        <nav>
          <a class:active={section === 'tutorial'} href="/tutorial"><span>01</span>Tutorial</a>
          <a class:active={section === 'how-to'} href="/how-to"><span>02</span>How-to guides</a>
          <a class:active={section === 'examples'} class="subpage" href="/examples"><span>↳</span>Examples</a>
          <a class:active={section === 'reference'} href="/reference"><span>03</span>Reference</a>
          <a class:active={section === 'explanation'} href="/explanation"><span>04</span>Explanation</a>
        </nav>
        <div><span>Up 0.0.1</span><a href="https://github.com/acoyfellow/up">Get the CLI →</a></div>
      </aside>
      <article class="doc">
      <p class="state-label">{eyebrow}</p>
      {#if section === 'tutorial'}
        <h1>Deploy the stack before signup</h1><p class="summary">Give an agent Worker code, browser assets, and binding names. Create an account only after the dynamic graph proves itself.</p>
        <h2>1. Build one app folder</h2><pre><code>app/
  public/index.html
  worker/index.js
  up.json</code></pre><p><code>worker/index.js</code> and sibling modules handle requests and call <code>env.ASSETS</code> for files under <code>public/</code>. <code>up.json</code> declares KV, D1, and Durable Object bindings.</p>
        <h2>2. Deploy anonymously</h2><pre><code>bunx github:acoyfellow/up deploy ./app</code></pre><p>Up snapshots the app and runs pinned Wrangler with isolated credentials. Wrangler creates the Temporary Account and provisions the supported resources.</p>
        <h2>3. Exercise or keep</h2><p>Fetch the page and API, mutate every binding, revise, and redeploy. Run <code>up claim --open</code> to keep the whole stack, or let every resource disappear.</p>
        <h2>4. Hand it back to your agent</h2><p>After the browser ownership flow, connect normal Wrangler with <code>wrangler login</code> and find the new account with <code>wrangler whoami</code>. Then continue the same Worker and bindings:</p><pre><code>up handoff ./app exact-worker-name \
  --account-id &lt;claimed-account-id&gt;</code></pre><p>No Up API key is needed. The URL stays public until you add Cloudflare Access or another login.</p><p><a href="https://github.com/acoyfellow/up/blob/main/docs/how-to/after-claim.md">Copy the agent handoff prompt →</a></p>
      {:else if section === 'how-to'}
        <h1>Iterate, keep, continue</h1><p class="summary">Temporary deployment is the first loop. Handoff reconnects the same source and resources to normal Wrangler.</p><h2>Redeploy before ownership</h2><p>Run <code>up deploy ./dist</code> again. A stable path fingerprint selects the same Worker name and Wrangler reuses the active temporary account.</p><h2>Initialize an agent</h2><pre><code>up init
# Ask the agent to read .up/SKILL.md
# Build into ./dist
up deploy ./dist</code></pre><h2>Keep the session</h2><pre><code>up claim --open</code></pre><p>The ownership link controls every deployment in the current anonymous Up session. Up stores it locally and does not print it unless you run <code>up claim --show</code>.</p><h2>Continue after ownership</h2><pre><code>bunx wrangler@4.103.0 login
bunx wrangler@4.103.0 whoami
up handoff ./dist exact-worker-name \
  --account-id &lt;claimed-account-id&gt;</code></pre><p>Wrangler OAuth is enough for local work. The handoff preflight refuses the wrong account or Worker name and preserves attached KV and D1 resources by binding name.</p><p><strong>The URL is still public.</strong> Add Access or another login before adding sensitive data, then verify an anonymous request is denied.</p><p><a href="https://github.com/acoyfellow/up/blob/main/docs/how-to/after-claim.md">Copy the agent handoff prompt →</a></p><p><a href="/examples">Browse apps built with Up →</a></p>
      {:else if section === 'examples'}
        <h1>Apps built with Up</h1><p class="summary">Small apps and the folders that power them. Lunch Vote demonstrates the retained company mode; anonymous examples are next.</p>
        <div class="example-list">
          <article class="example-row">
            <a class="example-thumb" href="https://github.com/acoyfellow/up/tree/main/examples/lunch-vote" target="_blank" rel="noopener noreferrer" aria-label="View the Lunch Vote source"><img src="/demos/lunch-vote.jpg" alt="Lunch Vote interface" width="1200" height="675" /></a>
            <div><p class="example-number">01 · IDENTITY / DB / FILES / AI / REALTIME</p><h2>Lunch Vote</h2><p>A historical company-mode example: vote with coworkers, see realtime updates, share a menu file, and ask Workers AI to summarize the result.</p><nav aria-label="Lunch Vote links"><a href="https://github.com/acoyfellow/up/tree/main/examples/lunch-vote" target="_blank" rel="noopener noreferrer">View source ↗</a></nav></div>
          </article>
        </div>
      {:else if section === 'reference'}
        <h1>Reference</h1><p class="summary">Exact anonymous dynamic-app contracts for version 0.0.1.</p><table><tbody><tr><th><code>public/index.html</code></th><td>Required browser entry point served as a Static Asset</td></tr><tr><th><code>worker/index.js</code></th><td>Optional module Worker entry point; sibling imports are preserved</td></tr><tr><th><code>up.json</code></th><td>Optional KV, D1, and Durable Object binding manifest</td></tr><tr><th><code>up deploy &lt;folder&gt; [name]</code></th><td>Provision and deploy one Temporary Account graph</td></tr><tr><th><code>up claim --open</code></th><td>Open the ownership flow without printing the sensitive link</td></tr><tr><th><code>up claim --show</code></th><td>Explicitly reveal the ownership link</td></tr><tr><th><code>up handoff &lt;folder&gt; &lt;name&gt; --account-id &lt;id&gt;</code></th><td>Continue the existing Worker after ownership using normal Wrangler OAuth</td></tr></tbody></table><h2>Current bindings</h2><ul><li>Static Assets via <code>env.ASSETS</code></li><li>KV namespace bindings</li><li>One D1 database, up to 100 MB total</li><li>Durable Object class bindings with SQLite migration</li><li>Queues and Hyperdrive are supported by Temporary Accounts; Up wiring is not shipped yet</li><li>Certificates are a supported account operation outside <code>up.json</code></li><li>R2, Workers AI, Access, Workflows, and Containers are unavailable anonymously</li></ul><h2>Connected services with Capa</h2><p>Capa keeps provider API keys out of app code and gives the Worker a smaller set of allowed actions for services such as GitHub and Stripe. A live same-account test passed; the simple installer is not shipped yet. <a href="https://github.com/acoyfellow/up/blob/main/docs/capa-integration.md">Read the integration contract →</a></p>
      {:else if section === 'explanation'}
        <h1>The dynamic graph comes first.</h1><p class="summary">Worker code and platform bindings exist before the deployer has a Cloudflare identity. That inversion is the product.</p><h2>Agents need real behavior</h2><p>A screenshot of static output cannot validate data, coordination, or API logic. Temporary Accounts let an agent exercise Worker, KV, D1, and Durable Object semantics in the real runtime.</p><h2>Bindings travel together</h2><p>The claim URL transfers the whole account, including the supported resources and data produced during the experiment. The app is not reconstructed after signup.</p><h2>Public is explicit</h2><p>The generated Worker URL has no Access boundary. Anyone with it can call the app. Up labels that fact instead of pretending a hard-to-guess hostname is private.</p><h2>Credentials stay isolated</h2><p>Up snapshots the folder, launches Wrangler in a separate home, and removes inherited Cloudflare credentials so the anonymous graph cannot mutate a permanent account.</p>
      {:else if section === 'offline'}
        <h1>You are offline.</h1><p class="summary">The documentation shell is cached. Publishing still requires the network and Access.</p>
      {:else}
        <h1>Page not found.</h1><p class="summary">The requested page does not exist.</p><a href="/">Return to Up</a>
      {/if}
      </article>
    </div>
  {/if}
</main>

<footer><span>{isProduct ? 'Up · Private workspace' : 'Up 0.0.1 · Documentation'}</span><nav><a href="/tutorial">Docs</a><a href="/reference">Reference</a><a href="https://github.com/acoyfellow/up">Source</a></nav></footer>

<style>
  :global(:root) {
    color-scheme: light;
    --white: #fff;
    --paper: #f7f9fb;
    --ink: #17212b;
    --muted: #5e6d79;
    --quiet: #7b8994;
    --line: #273a4924;
    --line-strong: #273a4940;
    --orange: #f6821f;
    --orange-hover: #e0700f;
    --amber: #f7b53b;
    --blue: #2678a4;
    --atmosphere: #71b8d8;
    --navy: #0b1118;
    --module: #182431;
    --cyan: #71b8d8;
    --green: #16835b;
    --red: #b83825;
    --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
    --page: 1240px;
    --reading: 780px;
    --gutter: clamp(20px, 4vw, 48px);
    --section: clamp(48px, 6vw, 76px);
    --control: 44px;
    --radius-sm: .25rem;
    --radius-md: .45rem;
    --radius-lg: .7rem;
    --shadow-lg: 0 24px 70px #2a3c4924;
  }
  :global(*) { box-sizing: border-box; }
  :global(html) { max-width:100%; overflow-x:clip; background:var(--white); scroll-behavior:smooth; }
  :global(body) { max-width:100%; min-width:320px; margin:0; overflow-x:clip; background:linear-gradient(180deg,#fff 0%,#fcfdfe 64%,var(--paper) 100%); color:var(--ink); font-family:var(--sans); font-synthesis:none; }
  :global(button), :global(input), :global(textarea), :global(select) { font: inherit; }
  :global(a) { color: inherit; }
  :global(code), :global(pre) { font-family: var(--mono); }
  :global(::selection) { background: #f6821f38; }
  :global(a:focus-visible), :global(button:focus-visible), :global(input:focus-visible), :global(textarea:focus-visible), :global(summary:focus-visible) { outline: 3px solid #71b8d8aa; outline-offset: 3px; }

  header, main, footer { width: min(100%, var(--page)); margin-inline: auto; padding-inline: var(--gutter); }
  header { position:relative; display:flex; height:72px; align-items:center; }
  header::after { position:absolute; right:50%; bottom:0; width:100vw; height:1px; background:var(--line); content:""; transform:translateX(50%); pointer-events:none; }
  .wordmark { display:inline-flex; align-items:center; text-decoration:none; }
  header nav { display: flex; align-items: center; gap: clamp(16px, 3vw, 30px); margin-left: auto; color: var(--muted); font-size: .76rem; }
  header nav a { text-decoration: none; transition: color .15s ease; }
  header nav a:hover { color: var(--ink); }
  .identity { display: inline-flex; max-width: min(310px, 60vw); min-height: 36px; align-items: center; gap: 8px; padding: 0 13px; overflow: hidden; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); font: 500 .66rem var(--mono); text-overflow: ellipsis; white-space: nowrap; }
  .identity > i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--green); }
  main { min-height:calc(100vh - 140px); padding-top:clamp(40px,6vw,72px); padding-bottom:clamp(72px,9vw,112px); overflow-x:clip; }
  main.home { width:100%; padding:0 0 clamp(72px,9vw,112px); overflow-x:clip; }
  footer { display: flex; min-height: 68px; align-items: center; border-top: 1px solid var(--line); color: var(--quiet); font: 500 .63rem var(--mono); }
  footer nav { display: flex; gap: 22px; margin-left: auto; }
  footer a { text-decoration: none; }

  .primary, .secondary, .link-button { display: inline-flex; min-height: var(--control); align-items: center; justify-content: center; padding: 0 18px; border: 1px solid; border-radius: var(--radius-md); font-size: .78rem; font-weight: 680; text-decoration: none; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease, box-shadow .15s ease; }
  .primary { border-color: var(--orange); background: var(--orange); color: #1d1009; box-shadow: 0 1px 0 #c8640a; }
  .primary:hover { border-color: var(--orange-hover); background: var(--orange-hover); transform: translateY(-1px); box-shadow: 0 6px 18px #f6821f2e; }
  .primary:disabled { opacity: .42; cursor: not-allowed; transform: none; box-shadow: none; }
  .secondary { border-color: var(--line-strong); background: #fff; color: var(--ink); }
  .secondary:hover { border-color: var(--ink); }
  .small { min-height: 36px; padding-inline: 13px; }
  .text-link, .text-button { padding: 0; border: 0; background: none; color: var(--blue); font-size: .73rem; text-decoration: none; cursor: pointer; }
  .state-label, .section-index { margin: 0; color: var(--quiet); font: 500 .64rem/1.3 var(--mono); letter-spacing: .09em; text-transform: uppercase; }
  .section-index { display: flex; align-items: center; gap: 11px; color: var(--orange); }
  .section-index::before { width: 24px; height: 1px; flex: 0 0 auto; background: var(--orange); content: ""; }

  /* Product front door */
  .home-shell { width:100%; }
  .home-shell > :not(.home-hero) { width:min(calc(100% - 2 * var(--gutter)),1120px); margin-inline:auto; }
  .home-hero { position:relative; display:flex; width:100%; min-height:clamp(620px,52vw,760px); align-items:center; margin:0; padding:clamp(70px,8vw,112px) max(var(--gutter),calc((100% - 1120px) / 2 + var(--gutter))); overflow:clip; border-bottom:1px solid var(--line); isolation:isolate; }
  .home-hero-copy { position:relative; z-index:2; width:min(46%,520px); min-width:0; }
  .home-art { position:absolute; z-index:-2; inset:0; display:block; overflow:hidden; pointer-events:none; }
  .home-art img { width:100%; height:100%; object-fit:cover; object-position:center 58%; }
  .ambient-mark { position:absolute; z-index:-1; top:-54px; right:-34px; width:420px; opacity:.12; mix-blend-mode:multiply; pointer-events:none; }
  .ambient-mark :global(svg) { width:100% !important; height:auto !important; }
  .paint-pattern { position:absolute; z-index:1; right:clamp(22px,5vw,84px); bottom:clamp(48px,7vw,104px); display:grid; width:clamp(280px,34vw,500px); grid-template-columns:repeat(4,1fr); justify-items:center; gap:clamp(18px,2.5vw,34px); opacity:.54; transform:rotate(-18deg); pointer-events:none; }
  .paint-pattern :global(svg) { mix-blend-mode:screen; }
  .paint-pattern :global(svg:nth-child(1)) { transform:translate(-18px,14px) rotate(-9deg) scale(.82); }
  .paint-pattern :global(svg:nth-child(2)) { transform:translate(8px,-12px) rotate(7deg) scale(1.08); }
  .paint-pattern :global(svg:nth-child(3)) { transform:translate(-5px,20px) rotate(-14deg) scale(.68); }
  .paint-pattern :global(svg:nth-child(4)) { transform:translate(20px,-2px) rotate(12deg) scale(1.2); }
  .paint-pattern :global(svg:nth-child(5)) { transform:translate(-10px,-8px) rotate(5deg) scale(1.12); }
  .paint-pattern :global(svg:nth-child(6)) { transform:translate(14px,17px) rotate(-11deg) scale(.76); }
  .paint-pattern :global(svg:nth-child(7)) { transform:translate(-22px,7px) rotate(15deg) scale(1.24); }
  .paint-pattern :global(svg:nth-child(8)) { transform:translate(11px,-15px) rotate(-5deg) scale(.9); }
  .home-kicker { display: flex; align-items: center; gap: 10px; color: var(--quiet); font: 500 .66rem var(--mono); letter-spacing: .06em; text-transform: uppercase; }
  .home-hero h1 { max-width: 580px; margin: 22px 0 20px; font-size: clamp(2.6rem, 5.2vw, 4rem); font-weight: 640; line-height: 1.02; letter-spacing: -.032em; }
  .home-hero h1 .accent { color: var(--blue); }
  .home-tagline { max-width: 470px; margin: 0; color: var(--muted); font-size: clamp(.98rem, 1.4vw, 1.1rem); line-height: 1.64; }
  .home-actions { display: flex; align-items: center; gap: 28px; margin-top: 32px; }
  .home-actions .primary { min-width: 136px; justify-content: space-between; gap: 28px; }
  .home-secondary { padding: 10px 0 7px; border-bottom: 1px solid var(--line-strong); color: var(--muted); font-size: .78rem; text-decoration: none; }
  .home-secondary:hover { border-color: var(--ink); color: var(--ink); }
  .hosted-note { display: flex; align-items: flex-start; gap: 8px; max-width: 440px; margin: 18px 0 0; color: var(--quiet); font-size: .68rem; line-height: 1.55; }
  .hosted-note i { width: 6px; height: 6px; flex: 0 0 auto; margin-top: .33em; border-radius: 50%; background: var(--green); }
  .hosted-note.caution { margin-top: 22px; color: var(--muted); }
  .hosted-note.caution i { background: var(--orange); }
  .shelf { padding: var(--section) var(--gutter); border-bottom: 1px solid var(--line); }
  .shelf-head { max-width: 760px; margin-bottom: 42px; }
  .shelf-head h2 { margin: 16px 0 0; font-size: clamp(1.65rem, 3vw, 2.45rem); font-weight: 640; line-height: 1.08; letter-spacing: -.028em; }
  .shelf-head > p { margin: 22px 0 0; color: var(--muted); font-size: 1rem; line-height: 1.74; }
  .native-label { margin-top: 0; }
  .feature-grid { display: grid; grid-template-columns: repeat(4, 1fr); overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); }
  .feature-grid article { min-height: 230px; padding: 24px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .feature-grid article:nth-child(4n) { border-right: 0; }
  .feature-grid article:nth-child(n+5) { border-bottom: 0; }
  .feature-grid article.pending { background: var(--paper); }
  .native-title { display: flex; align-items: center; gap: 10px; }
  .native-title img { width: 30px; height: 30px; object-fit: contain; }
  .native-title span { font-size: .82rem; font-weight: 680; }
  .feature-grid small { display: block; width: fit-content; margin-top: 18px; padding: 4px 6px; border: 1px solid #f6821f55; border-radius: 3px; color: #9a4c08; font: 500 .54rem var(--mono); letter-spacing: .03em; }
  .feature-grid article.pending small { border-color: var(--line-strong); color: var(--quiet); }
  .feature-grid h3 { margin: 20px 0 10px; font-size: .96rem; letter-spacing: -.018em; }
  .feature-grid p { margin: 0; color: var(--muted); font-size: .75rem; line-height: 1.62; }
  .connected-services { display: grid; grid-template-columns: 1fr; gap: 24px; margin-top: 28px; padding: 30px; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: var(--paper); }
  .connected-services h3 { margin: 16px 0 10px; font-size: clamp(1.2rem, 2vw, 1.55rem); letter-spacing: -.022em; }
  .connected-copy { max-width: 660px; margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.68; }
  .catalog-label { margin: 26px 0 10px; color: var(--quiet); font: 500 .6rem var(--mono); letter-spacing: .07em; text-transform: uppercase; }
  .capa-catalog { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); list-style: none; }
  .capa-catalog li { display: grid; min-height: 78px; grid-template-columns: 25px minmax(0, 1fr); align-items: center; gap: 8px; padding: 10px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: #fff; }
  .capa-catalog li:nth-child(7n) { border-right: 0; }
  .capa-catalog li:nth-child(n+8) { border-bottom: 0; }
  .capa-catalog img { width: 22px; height: 22px; object-fit: contain; }
  .capa-catalog span { overflow: hidden; font-size: .66rem; font-weight: 650; line-height: 1.25; text-overflow: ellipsis; }
  .connected-status { display: grid; align-content: center; gap: 10px; padding-top: 22px; border-top: 1px solid var(--line); }
  .connected-status strong { font-size: .82rem; }
  .connected-status span { color: var(--muted); font-size: .7rem; line-height: 1.55; }
  .connected-status a { width: fit-content; margin-top: 5px; color: var(--blue); font-size: .72rem; text-decoration: none; }
  .connected-status a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .after-keep { display: grid; grid-template-columns: 150px minmax(0, 650px); gap: 22px; margin-top: 24px; padding: 18px 0; border-block: 1px solid var(--line); }
  .after-keep strong { font-size: .76rem; }
  .after-keep span { color: var(--muted); font-size: .74rem; line-height: 1.6; }
  .shelf-cta { min-width: 200px; margin-top: 34px; justify-content: space-between; gap: 28px; }

  /* Docs */
  .docs-shell { display: grid; grid-template-columns: 200px minmax(0, var(--reading)); gap: clamp(42px, 7vw, 78px); width: min(100%, 1060px); margin-inline: auto; align-items: start; }
  .docs-nav { position: sticky; top: 28px; min-height: 520px; padding-right: 24px; border-right: 1px solid var(--line); }
  .docs-nav > p { margin: 0 0 20px; color: var(--quiet); font: 500 .62rem var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .docs-nav nav { display: grid; }
  .docs-nav nav a { display: grid; grid-template-columns: 28px 1fr; min-height: 43px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: .75rem; text-decoration: none; }
  .docs-nav nav a span { color: var(--quiet); font: 500 .57rem var(--mono); }
  .docs-nav nav a:hover, .docs-nav nav a.active { background: var(--paper); color: var(--ink); }
  .docs-nav nav a.active { box-shadow: inset 2px 0 var(--orange); }
  .docs-nav nav a.subpage { min-height: 36px; padding-left: 18px; font-size: .69rem; }
  .docs-nav > div { display: grid; gap: 8px; margin-top: 28px; padding: 14px 8px; border-top: 1px solid var(--line); font: 500 .61rem var(--mono); }
  .docs-nav > div span { color: var(--quiet); }
  .docs-nav > div a { color: var(--blue); text-decoration: none; }
  .doc { width: 100%; min-width: 0; padding-bottom: 72px; }
  .doc > .state-label { margin-bottom: 22px; }
  .doc h1 { max-width: 720px; margin: 0; font-size: clamp(2.1rem, 4vw, 3.1rem); font-weight: 640; line-height: 1.04; letter-spacing: -.03em; }
  .doc .summary { max-width: 690px; margin: 22px 0 52px; padding-bottom: 38px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 1.03rem; line-height: 1.66; }
  .doc h2 { margin: 52px 0 12px; padding-top: 17px; border-top: 1px solid var(--line); font-size: 1.05rem; }
  .doc p, .doc li { color: var(--muted); font-size: .82rem; line-height: 1.72; }
  .doc pre { margin: 18px 0; padding: 16px; overflow: auto; border: 1px solid var(--line); background: var(--paper); font-size: .72rem; line-height: 1.65; }
  .doc table { width: 100%; border-collapse: collapse; border-top: 1px solid var(--line-strong); }
  .doc th, .doc td { padding: 14px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: .74rem; }
  .doc th { width: 54%; font-weight: 550; }
  .doc td { color: var(--muted); }
  .example-list { border-top: 1px solid var(--line-strong); }
  .example-row { display: grid; grid-template-columns: clamp(128px, 22%, 168px) minmax(0, 1fr); align-items: start; gap: clamp(18px, 3vw, 28px); padding: 24px 0; border-bottom: 1px solid var(--line); }
  .example-thumb { display: block; width: 100%; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--paper); aspect-ratio: 16 / 9; }
  .example-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .2s ease; }
  .example-thumb:hover img { transform: scale(1.03); }
  .example-row > div { min-width: 0; }
  .example-row h2 { margin: 6px 0 8px; padding: 0; border: 0; font-size: 1.05rem; }
  .example-row p { max-width: 520px; margin: 0; }
  .example-row .example-number { overflow-wrap: anywhere; color: var(--orange); font: 500 .55rem/1.45 var(--mono); letter-spacing: .04em; }
  .example-row nav { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; }
  .example-row nav a { color: var(--blue); font-size: .68rem; text-decoration: none; }
  .example-row nav a:hover { text-decoration: underline; text-underline-offset: 3px; }

  /* Publisher */
  main.product { padding-top: clamp(36px, 5vw, 56px); }
  .workspace { min-height: calc(100vh - 240px); }
  .file-input { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .empty-state { position: relative; display: grid; width: min(100%, 1120px); min-height: clamp(580px, calc(100vh - 230px), 760px); place-items: center; margin-inline: auto; overflow: hidden; border: 1px dashed var(--line-strong); border-radius: 12px; background: linear-gradient(180deg,#fff,#fbfcfc); text-align: center; isolation: isolate; }
  .empty-state::after { position:absolute; z-index:-1; right:-13%; bottom:-25%; width:58%; height:52%; background:url('/images/up-hero-paint.webp') center/cover no-repeat; content:""; opacity:.13; transform:rotate(-4deg); pointer-events:none; }
  .empty-state::before { position: absolute; inset: 14px; border: 2px solid transparent; border-radius: 8px; content: ""; pointer-events: none; transition: border-color .15s ease, background .15s ease; }
  .empty-state.dragging::before { border-color: var(--orange); background: #f6821f0a; }
  .empty-copy { position: relative; z-index: 1; width:min(760px,calc(100% - 48px)); padding: 64px 0; }
  .empty-state h1, .worker-builder h1, .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1 { margin: 0; font-weight: 640; line-height: 1.04; letter-spacing: -.03em; }
  .empty-state h1 { margin-top:14px; font-size: clamp(2.7rem, 6vw, 5.1rem); line-height: .96; }
  .empty-copy > p:not(.state-label) { max-width: 620px; margin: 24px auto 34px; color: var(--muted); font-size: 1rem; line-height: 1.64; }
  .workspace-choices { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .workspace-choice { display:grid; min-height:190px; align-content:center; justify-items:start; gap:7px; padding:26px; border:1px solid var(--line-strong); border-radius:9px; background:#fff; color:var(--ink); text-align:left; cursor:pointer; transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease; }
  .workspace-choice:hover { border-color:var(--orange); transform:translateY(-2px); box-shadow:0 12px 30px #0b111810; }
  .workspace-choice strong { font-size:1.1rem; }
  .workspace-choice small { max-width:260px; margin:0; color:var(--muted); font-size:.75rem; line-height:1.5; }
  .choice-icon { display:grid; width:40px; height:40px; place-items:center; margin-bottom:12px; border-radius:50%; background:#f6821f18; color:var(--orange); font:700 1.2rem var(--mono); }
  .choice-icon.code { background:#2678a418; color:var(--blue); font-size:.78rem; }
  .access-note { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:26px; color:var(--quiet); font-size:.68rem; }
  .access-note > i, .privacy i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--green); }
  .worker-builder { width:min(100%,1120px); min-height:calc(100vh - 230px); margin-inline:auto; }
  .builder-head { display:flex; align-items:end; justify-content:space-between; gap:20px; margin-bottom:24px; }
  .worker-builder h1 { margin-top:8px; font-size:clamp(2.2rem,4vw,3.4rem); }
  .builder-grid { display:grid; grid-template-columns:minmax(0,1fr) 300px; overflow:hidden; border:1px solid var(--line-strong); border-radius:9px; }
  .editor-panel { min-width:0; padding:22px; border-right:1px solid var(--line); background:#fff; }
  .worker-name,.code-editor { display:grid; gap:8px; color:var(--muted); font-size:.68rem; font-weight:650; }
  .worker-name input { height:42px; padding:0 12px; border:1px solid var(--line); border-radius:5px; font:600 .82rem var(--mono); }
  .code-editor { margin-top:18px; }
  .code-editor textarea { width:100%; min-height:430px; resize:vertical; padding:18px; border:0; border-radius:6px; background:#0b1118; color:#dce7ed; font:13px/1.6 var(--mono); tab-size:2; }
  .binding-panel { padding:22px; background:var(--paper); }
  .binding-panel > label { display:flex; align-items:flex-start; gap:10px; padding:16px 0; border-bottom:1px solid var(--line); cursor:pointer; }
  .binding-panel input { margin-top:.25em; }
  .binding-panel label span { display:grid; gap:3px; }
  .binding-panel label small { color:var(--muted); font-size:.68rem; }
  .builder-boundary { display:grid; gap:6px; margin-top:24px; padding:15px; border-left:3px solid var(--orange); background:#fff; }
  .builder-boundary.connected { border-left-color:var(--green); }
  .builder-boundary p { margin:0; color:var(--muted); font-size:.7rem; line-height:1.55; }
  .builder-boundary code { overflow-wrap:anywhere; color:var(--blue); font-size:.62rem; }
  .builder-boundary .text-button { width:max-content; }
  .worker-consent { display:grid; gap:9px; margin:20px 0 0; padding:14px 0 0; border:0; border-top:1px solid var(--line); }
  .worker-consent legend { padding:0; font-size:.7rem; font-weight:700; }
  .worker-consent label { display:flex; gap:8px; color:var(--muted); font-size:.67rem; line-height:1.45; }
  .worker-consent input { margin-top:.2em; }
  .builder-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:16px; }
  .builder-status { padding:14px; border-left:3px solid var(--green); background:var(--paper); color:var(--muted); font-size:.75rem; overflow-wrap:anywhere; }
  .builder-status a { color:var(--blue); }
  .selected-view, .publishing-view, .success-view, .list-view { width: min(100%, 820px); margin-inline: auto; }
  .selected-view, .publishing-view, .success-view { padding-left: 28px; border-left: 2px solid var(--orange); }
  .back { min-height: 36px; margin: 0 0 44px; padding: 0; border: 0; background: none; color: var(--muted); font: 500 .68rem var(--mono); cursor: pointer; }
  .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1 { font-size: clamp(1.85rem, 3.4vw, 2.6rem); }
  .view-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 38px; }
  .file-summary { display: grid; grid-template-columns: repeat(3, 1fr); margin: 40px 0; border-block: 1px solid var(--line); }
  .file-summary div { display: flex; min-height: 80px; flex-direction: column; justify-content: space-between; padding: 14px 16px; border-right: 1px solid var(--line); }
  .file-summary div:first-child { padding-left: 0; }
  .file-summary div:last-child { border-right: 0; }
  dt { color: var(--muted); font-size: .73rem; }
  dd { margin: 0; font: 500 .71rem var(--mono); }
  dd.valid { color: var(--green); }
  .address { display: grid; gap: 10px; }
  .address > span { font-size: .72rem; font-weight: 650; }
  .address > div { display: flex; min-height: 50px; align-items: center; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 4px; background: #fff; }
  .address > div:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px #2678a41f; }
  .address input { min-width: 0; height: 48px; flex: 1; padding: 0 14px; border: 0; outline: 0; font: 400 .82rem var(--mono); }
  .address em { padding-right: 14px; color: var(--quiet); font: 400 .71rem var(--mono); font-style: normal; }
  .address > small { color: var(--quiet); font-size: .66rem; line-height: 1.45; }
  .privacy { display: flex; width: max-content; align-items: center; gap: 8px; margin: 16px 0 38px; padding: 7px 10px; border: 1px solid #dce8df; border-radius: 999px; background: #f8fcf9; color: #496052; font-size: .7rem; }
  .footer-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 18px; border-top: 1px solid var(--line); }
  .steps { margin: 40px 0 30px; border-top: 1px solid var(--line); }
  .steps div { position: relative; display: flex; justify-content: space-between; padding: 13px 0 13px 25px; border-bottom: 1px solid var(--line); font-size: .76rem; }
  .steps div::before { position: absolute; top: 50%; left: 1px; width: 7px; height: 7px; border: 2px solid var(--line-strong); border-radius: 50%; background: #fff; content: ""; transform: translateY(-50%); }
  .steps b { font: 500 .66rem var(--mono); }
  .progress { height: 4px; overflow: hidden; border-radius: 99px; background: var(--line); }
  .progress i { display: block; height: 100%; background: linear-gradient(90deg, var(--navy), var(--cyan), var(--orange)); transition: width .2s; }
  .progress-number { margin: 8px 0 32px; color: var(--muted); font: 500 .63rem var(--mono); text-align: right; }
  .publishing-view > small { color: var(--quiet); font-size: .7rem; }
  .state-label.success { color: var(--green); }
  .success-view { position: relative; }
  .success-view::after { position: absolute; top: -15px; right: 0; width: 116px; height: 8px; background: linear-gradient(90deg, var(--navy) 0 32%, var(--cyan) 32% 52%, var(--orange) 52%); content: ""; transform: skewX(-26deg); }
  .published-url { display: block; margin: 24px 0 28px; color: var(--blue); font: 500 .82rem var(--mono); text-decoration: none; word-break: break-all; }
  .success-actions { display: flex; align-items: center; gap: 22px; }
  .receipt { margin: 48px 0 30px; border-top: 1px solid var(--line); }
  .receipt div { display: flex; justify-content: space-between; padding: 13px 0; border-bottom: 1px solid var(--line); }
  .receipt dd { font-family: var(--sans); }
  .site-list { border-top: 1px solid var(--line-strong); }
  .site-list article { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, auto); gap: 24px; padding: 22px 8px; border-bottom: 1px solid var(--line); transition: background .14s; }
  .site-list article:hover { background: var(--paper); }
  .site-list article > div { display: grid; gap: 6px; align-content: start; }
  .site-list article > div:last-child { justify-items: end; text-align: right; }
  .site-list strong { font-size: .94rem; }
  .site-list code, .site-list span, .site-list small { color: var(--muted); font-size: .66rem; }
  .site-list a { width: max-content; max-width: 100%; color: var(--muted); text-decoration: none; }
  .site-list a:hover { text-decoration: underline; text-underline-offset: 3px; }

  @media (max-width: 900px) {
    .home-hero { min-height:0; align-items:flex-end; padding-top:270px; padding-bottom:56px; }
    .home-hero-copy { width:min(100%,600px); }
    .home-art { top:0; right:auto; bottom:auto; left:-18%; width:138%; height:250px; }
    .home-art img { object-position:64% 72%; }
    .ambient-mark { top:-32px; right:-24px; width:260px; opacity:.1; }
    .paint-pattern { top:74px; right:-18px; bottom:auto; width:270px; grid-template-columns:repeat(2,1fr); gap:20px; opacity:.58; }
    .feature-grid { grid-template-columns: repeat(2, 1fr); }
    .feature-grid article:nth-child(n) { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .feature-grid article:nth-child(2n) { border-right: 0; }
    .feature-grid article:nth-last-child(-n+2) { border-bottom: 0; }
    .capa-catalog { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .capa-catalog li:nth-child(n) { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .capa-catalog li:nth-child(2n) { border-right: 0; }
    .capa-catalog li:nth-last-child(-n+2) { border-bottom: 0; }
    .docs-shell { grid-template-columns: 1fr; gap: 40px; }
    .docs-nav { position: static; min-height: 0; padding: 0 0 12px; overflow: hidden; border-right: 0; border-bottom: 1px solid var(--line); }
    .docs-nav > p { margin-bottom: 12px; }
    .docs-nav nav { display: flex; overflow-x: auto; border-block: 1px solid var(--line); scrollbar-width: thin; }
    .docs-nav nav a, .docs-nav nav a.subpage { min-width: max-content; flex: 0 0 auto; grid-template-columns: 24px auto; padding: 0 15px; border-right: 1px solid var(--line); border-bottom: 0; }
    .docs-nav nav a:last-child { border-right: 0; }
    .docs-nav > div { display: none; }
    .builder-grid { grid-template-columns:1fr; }
    .editor-panel { border-right:0; border-bottom:1px solid var(--line); }
    .binding-panel { display:grid; grid-template-columns:repeat(3,1fr); gap:0 16px; }
    .binding-panel > .state-label,.builder-boundary { grid-column:1/-1; }
    .empty-copy { padding:52px 0; }
  }

  @media (max-width: 600px) {
    header, main, footer { padding-inline: 18px; }
    header nav a:not(:last-child) { display: none; }
    main { padding-top: 34px; padding-bottom: 64px; }
    main.home { padding-inline:0; }
    .home-shell > :not(.home-hero) { width:calc(100% - 36px); }
    .home-hero { min-height:0; padding:295px 32px 48px; }
    .home-hero h1 { font-size: clamp(2.15rem, 10vw, 2.9rem); }
    .home-actions { align-items: flex-start; flex-direction: column; gap: 12px; }
    .home-art { top:0; right:auto; left:-30%; width:165%; height:285px; }
    .home-art img { object-position:62% 78%; }
    .ambient-mark { top:-28px; right:-26px; width:200px; opacity:.09; }
    .paint-pattern { top:92px; right:-16px; width:200px; gap:14px; opacity:.6; }
    .shelf { padding: 56px 14px; }
    .feature-grid { grid-template-columns: 1fr; }
    .feature-grid article:nth-child(n) { min-height: 210px; border-right: 0; border-bottom: 1px solid var(--line); }
    .feature-grid article:last-child { border-bottom: 0; }
    .feature-grid h3 { margin-top: 20px; }
    .connected-services { padding: 22px; }
    .after-keep { grid-template-columns: 1fr; gap: 8px; }
    .doc h1 { font-size: clamp(2.2rem, 13vw, 3rem); }
    .doc .summary { margin-bottom: 36px; padding-bottom: 28px; font-size: .94rem; }
    .example-row { grid-template-columns: 92px minmax(0, 1fr); gap: 14px; padding: 20px 0; }
    .example-row h2 { margin-top: 4px; }
    .example-row p { font-size: .76rem; line-height: 1.6; }
    .example-row nav { display: grid; gap: 7px; margin-top: 12px; }
    .empty-state { min-height: calc(100vh - 180px); border-radius:8px; }
    .empty-copy { width:calc(100% - 28px); padding:38px 0; }
    .empty-state h1 { font-size: clamp(2.4rem, 13vw, 3.4rem); }
    .workspace-choices { grid-template-columns:1fr; }
    .workspace-choice { min-height:150px; }
    .builder-head { align-items:start; }
    .builder-grid { grid-template-columns:1fr; }
    .editor-panel,.binding-panel { padding:15px; }
    .binding-panel { display:block; }
    .code-editor textarea { min-height:360px; font-size:12px; }
    .builder-actions { display:grid; grid-template-columns:1fr; }
    .builder-actions button { width:100%; }
    .selected-view, .publishing-view, .success-view { padding-left: 18px; }
    .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1 { font-size: 2.7rem; }
    .file-summary { grid-template-columns: 1fr; }
    .file-summary div, .file-summary div:first-child { min-height: 56px; flex-direction: row; align-items: center; padding: 12px 0; border-right: 0; border-bottom: 1px solid var(--line); }
    .file-summary div:last-child { border-bottom: 0; }
    .address > div { display: grid; }
    .address em { padding: 0 14px 11px; }
    .footer-actions { display: grid; grid-template-columns: 1fr 1.35fr; }
    .footer-actions > * { width: 100%; }
    .site-list article { grid-template-columns: 1fr; }
    .site-list article > div:last-child { justify-items: start; text-align: left; }
    footer nav a:first-child { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*) { scroll-behavior: auto !important; transition: none !important; }
  }
</style>
