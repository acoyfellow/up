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
  let view = $state<'empty' | 'selected' | 'publishing' | 'success' | 'list'>(
    untrack(() => initialSites.length) ? 'list' : 'empty',
  );
  let input = $state<HTMLInputElement>();
  let siteNameInput = $state<HTMLInputElement>();

  const deployUrl =
    'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/up';
  const isProduct = $derived(section === 'app');

  onMount(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
    // SvelteKit supplies authoritative product data in the initial SSR payload.
    // The fallback keeps the legacy renderer functional during migration only.
    if (isProduct && !productLoaded) void initializeProduct();
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
      <a href="/#demos">Demos</a>
      <a href="/tutorial">Docs</a>
      <a href="/explanation">How it works</a>
      <a href="/app">Open Up ↗</a>
    {:else}
      <span class="identity"><i aria-hidden="true"></i>{identity}</span>
    {/if}
  </nav>
</header>

<main class:product={isProduct} class:home={section === 'home'}>
  {#if section === 'home'}
    <div class="home-shell">
      <section class="home-hero" aria-labelledby="home-title">
        <div class="home-hero-copy">
          <div class="home-kicker"><span>Cloudflare-native</span><i aria-hidden="true"></i><span>Private by default</span></div>
          <h1 id="home-title">Your company’s<br /><span class="accent">private web.</span></h1>
          <p class="home-tagline">Publish a folder to a company-private URL behind the identity system your organization already trusts.</p>
          <div class="home-actions">
            <a class="primary link-button" href="/app">Open Up <span aria-hidden="true">→</span></a>
            <a class="home-secondary" href="/tutorial">Install your own</a>
          </div>
          <p class="hosted-note"><i aria-hidden="true"></i>Cloudflare’s hosted installation is currently available to Cloudflare employees.</p>
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

      <section class="home-intro" aria-labelledby="intro-title">
        <p class="section-index">01 / PRODUCT</p>
        <div>
          <h2 id="intro-title">One installation.<br />Every small site.</h2>
          <p>Up gives employees and agents one dependable place to publish prototypes, reports, demos, and internal tools. Files stay in private R2. Every request meets Cloudflare Access first.</p>
        </div>
      </section>

      <section class="feature-grid" aria-label="Product capabilities">
        <article><span>01</span><h3>Publish a folder</h3><p>HTML, CSS, JavaScript, and assets. No framework or build system required.</p></article>
        <article><span>02</span><h3>Know the viewer</h3><p><code>up.identity</code> returns the employee identity already verified by Access.</p></article>
        <article><span>03</span><h3>Store records</h3><p><code>up.db</code> provides site-scoped document collections backed by SQLite.</p></article>
        <article><span>04</span><h3>Share files</h3><p><code>up.files</code> stores bounded site files in private R2 without credentials.</p></article>
        <article><span>05</span><h3>Call AI</h3><p><code>up.ai</code> uses the installation’s fixed Workers AI policy.</p></article>
        <article><span>06</span><h3>Update live</h3><p><code>up.realtime</code> connects authenticated browsers through site-scoped rooms.</p></article>
        <article><span>07</span><h3>Publish atomically</h3><p>Every digest is verified before a deployment becomes visible. Partial updates never leak.</p></article>
        <article><span>08</span><h3>Stay in control</h3><p>The Worker, Durable Objects, R2, DNS, and Access app remain in your account.</p></article>
      </section>

      <section class="demo-showcase" id="demos" aria-labelledby="demos-title">
        <div class="demo-heading">
          <div><p class="section-index">02 / BUILT WITH UP</p><h2 id="demos-title">Small apps. Real capabilities.</h2></div>
          <p>Each demo is a folder published through Up. Live sites remain behind the company’s Access boundary.</p>
        </div>
        <article class="demo-card">
          <a class="demo-preview" href="https://lunch-vote.up.ax.cloudflare.dev" target="_blank" rel="noopener noreferrer" aria-label="Open the Lunch Vote live demo">
            <img src="/demos/lunch-vote.jpg" alt="Lunch Vote showing authenticated voting and a connected realtime room" width="1200" height="675" loading="lazy" />
            <span>Open live demo <i aria-hidden="true">↗</i></span>
          </a>
          <div class="demo-copy">
            <div><span class="demo-status"><i aria-hidden="true"></i>Cloudflare employees</span><span>01</span></div>
            <h3>Lunch Vote</h3>
            <p>Vote with coworkers, watch every open browser update, share a menu file, and ask Workers AI to summarize the result.</p>
            <ul aria-label="Capabilities used"><li>Identity</li><li>Database</li><li>Files</li><li>AI</li><li>Realtime</li></ul>
            <div class="demo-links"><a href="https://lunch-vote.up.ax.cloudflare.dev" target="_blank" rel="noopener noreferrer">Open site ↗</a><a href="https://github.com/acoyfellow/up/tree/feat/quick-parity-0.0.1/examples/lunch-vote" target="_blank" rel="noopener noreferrer">View three-file source ↗</a></div>
          </div>
        </article>
      </section>

      <section class="system-model" aria-labelledby="model-title">
        <p class="section-index">03 / SYSTEM</p>
        <div>
          <h2 id="model-title">Folder to private URL.</h2>
          <div class="model-flow" aria-label="Folder to private URL workflow">
            <span>static folder</span><i>→</i><span>verified upload</span><i>→</i><span>private R2</span><i>→</i><span>Access URL</span>
          </div>
          <ol>
            <li><strong>Connect</strong><span>Approve Up once in Cloudflare.</span></li>
            <li><strong>Publish</strong><span>Choose a folder and name the site.</span></li>
            <li><strong>Prove</strong><span>Verify authenticated content and anonymous denial.</span></li>
          </ol>
        </div>
      </section>

      <section class="docs-map" aria-labelledby="docs-title">
        <div class="docs-map-heading"><div><p class="section-index">04 / DOCUMENTATION</p><h2 id="docs-title">Read for the job at hand.</h2></div><p>Up follows Diátaxis: learning, goals, information, and understanding stay distinct.</p></div>
        <div class="docs-quadrants">
          <a href="/tutorial"><span>LEARNING</span><strong>Tutorial</strong><p>Connect Cloudflare and publish a first private site.</p><i aria-hidden="true">01 →</i></a>
          <a href="/how-to"><span>GOALS</span><strong>How-to guides</strong><p>Update, operate, verify, and respond safely.</p><i aria-hidden="true">02 →</i></a>
          <a href="/reference"><span>INFORMATION</span><strong>Reference</strong><p>Routes, limits, bindings, headers, and exact contracts.</p><i aria-hidden="true">03 →</i></a>
          <a href="/explanation"><span>UNDERSTANDING</span><strong>Explanation</strong><p>Why the Access boundary and atomic model matter.</p><i aria-hidden="true">04 →</i></a>
        </div>
      </section>

      <section class="read-next" aria-labelledby="next-title">
        <p class="section-index">WHAT TO READ NEXT</p>
        <div><h2 id="next-title">Start with a first publish.</h2><a href="/tutorial">Your first Up site <span aria-hidden="true">→</span></a></div>
      </section>
    </div>
  {:else if section === 'app'}
    <section class="workspace" aria-label="Up publisher">
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
            <p class="state-label">{isProduct ? 'Private workspace' : 'Ready to publish'}</p>
            <h1>Publish a site.</h1>
            <p>Choose a static folder. Up gives it a company-private URL.</p>
            <button class="primary choose" onclick={chooseFolder}>Choose a folder <span aria-hidden="true">↗</span></button>
            <small><i aria-hidden="true"></i> Protected by Cloudflare Access</small>
          </div>
          <picture class="brand-stroke" aria-hidden="true">
            <source srcset="/images/up-hero-paint.webp" type="image/webp" />
            <img src="/images/up-hero-paint.jpg" alt="" width="1536" height="1024" />
          </picture>
        </div>
      {:else if view === 'list'}
        <div class="list-view">
          <div class="view-heading">
            <div><p class="state-label">Sites</p><h1>Your sites</h1></div>
            <button class="primary small" onclick={chooseFolder}>Publish site</button>
          </div>
          <div class="site-list">
            {#each sites as site}
              <article>
                <div><strong>{site.name}</strong><a href={`https://${site.name}.${siteDomain}`} target="_blank" rel="noopener noreferrer"><code>{site.name}.{siteDomain}</code></a></div>
                <div><span>{site.owner}</span><small>Company · {site.activeDeploymentId ? 'Published' : 'Pending'}</small></div>
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
          <a class:active={section === 'reference'} href="/reference"><span>03</span>Reference</a>
          <a class:active={section === 'explanation'} href="/explanation"><span>04</span>Explanation</a>
        </nav>
        <div><span>Up 0.0.1</span><a href="/app">Open publisher →</a></div>
      </aside>
      <article class="doc">
      <p class="state-label">{eyebrow}</p>
      {#if section === 'tutorial'}
        <h1>Set up Up</h1><p class="summary">Connect your Cloudflare account once. Up provisions itself and the Access boundary on your behalf — no API tokens to mint.</p>
        <h2>1. Connect with Cloudflare</h2><p><a class="primary link-button" href="/how-to">Connect with Cloudflare</a></p><p>You review the requested scopes on Cloudflare’s consent screen and approve. Up creates the Worker, Durable Object, private R2 bucket, and Access application — all in your account.</p>
        <h2>2. Choose who gets in</h2><p>The Access policy defaults to your company email domain. Point it at your existing SSO (Okta, Entra, Google) or Cloudflare authentication. Everyone in the company; nobody outside.</p>
        <h2>3. Verify before use</h2><p>Publish a folder while authenticated. Open the resulting URL in a clean browser. It must reach Access before any uploaded bytes. <code>workers.dev</code> and Preview URLs stay disabled.</p>
        <p>Prefer to fork and self-host the source? <a href={deployUrl}>Deploy to Cloudflare ↗</a></p>
      {:else if section === 'how-to'}
        <h1>Operate Up</h1><p class="summary">Publish the same folder from the browser, CLI, or an agent.</p><h2>Update a site</h2><p>Publish the same name. Up activates the replacement only after every new asset passes verification.</p><h2>Initialize an agent</h2><pre><code>up init
# Ask the agent to read .up/SKILL.md
# Build into ./dist
up deploy ./dist team-tool</code></pre><h2>Use fixed capabilities</h2><p>Import <code>/_up/client.js</code>. Identity, document collections, files, AI, and realtime are available without credentials or per-site infrastructure.</p><h2>Respond to exposure</h2><p>Disable the wildcard route or Access application first. Never enable <code>workers.dev</code> as a workaround.</p>
      {:else if section === 'reference'}
        <h1>Reference</h1><p class="summary">Exact contracts for version 0.0.1.</p><table><tbody><tr><th><code>GET /app</code></th><td>Authenticated publisher</td></tr><tr><th><code>GET /api/sites</code></th><td>List company sites</td></tr><tr><th><code>POST /api/sites/:name/deployments</code></th><td>Create a pending company deployment</td></tr><tr><th><code>PUT /api/deployments/:id/assets</code></th><td>Verify and store one asset</td></tr><tr><th><code>POST /api/deployments/:id/activate</code></th><td>Atomically activate a deployment</td></tr><tr><th><code>GET /_up/identity</code></th><td>Current verified employee</td></tr><tr><th><code>/_up/db/*</code></th><td>Site document collections</td></tr><tr><th><code>/_up/files/*</code></th><td>Site file storage</td></tr><tr><th><code>POST /_up/ai/chat</code></th><td>Bounded Workers AI request</td></tr><tr><th><code>GET /_up/realtime/:channel</code></th><td>Authenticated WebSocket channel</td></tr></tbody></table><h2>Limits</h2><ul><li>500 deployment files; 10 MiB each; 50 MiB total</li><li><code>index.html</code> required</li><li>64 KiB per database document; 100 documents per page</li><li>10 MiB per site file; 1,000 listed files</li><li>24 AI messages; 20,000 input characters; 512 output tokens</li><li>16 KiB per realtime message</li></ul>
      {:else if section === 'explanation'}
        <h1>A URL does not grant access.</h1><p class="summary">Up verifies a company session before returning a site or any of its capabilities.</p><h2>One company boundary</h2><p>Cloudflare Access authenticates employees. Up converts that identity into a scoped sibling-domain session. Missing identity returns no uploaded content.</p><h2>The hostname selects one site</h2><p>Database collections, uploaded files, AI requests, and realtime channels are resolved from the current site hostname. Browser code cannot supply another site’s resource ID.</p><h2>Credentials stay on the server</h2><p>The browser receives a fixed same-origin API. R2, Durable Object, and Workers AI credentials never enter site code.</p><h2>A deployment appears all at once</h2><p>Files remain pending in private R2 until every manifest digest passes verification. Activation changes one pointer, so visitors receive either the previous complete version or the next one.</p>
      {:else if section === 'offline'}
        <h1>You are offline.</h1><p class="summary">The documentation shell is cached. Publishing still requires the network and Access.</p>
      {:else}
        <h1>Page not found.</h1><p class="summary">The requested page does not exist.</p><a href="/">Return to Up</a>
      {/if}
      </article>
    </div>
  {/if}
</main>

<footer><span>Up 0.0.1 · Private by default</span><nav><a href="/tutorial">Setup</a><a href="/reference">Reference</a><a href="https://github.com/acoyfellow/up">GitHub</a></nav></footer>

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
  .home-kicker i { width: 5px; height: 5px; border-radius: 50%; background: var(--orange); }
  .home-hero h1 { max-width: 580px; margin: 22px 0 20px; font-size: clamp(2.6rem, 5.2vw, 4rem); font-weight: 640; line-height: 1.02; letter-spacing: -.032em; }
  .home-hero h1 .accent { color: var(--blue); }
  .home-tagline { max-width: 470px; margin: 0; color: var(--muted); font-size: clamp(.98rem, 1.4vw, 1.1rem); line-height: 1.64; }
  .home-actions { display: flex; align-items: center; gap: 28px; margin-top: 32px; }
  .home-actions .primary { min-width: 136px; justify-content: space-between; gap: 28px; }
  .home-secondary { padding: 10px 0 7px; border-bottom: 1px solid var(--line-strong); color: var(--muted); font-size: .78rem; text-decoration: none; }
  .home-secondary:hover { border-color: var(--ink); color: var(--ink); }
  .hosted-note { display: flex; align-items: flex-start; gap: 8px; max-width: 440px; margin: 18px 0 0; color: var(--quiet); font-size: .68rem; line-height: 1.55; }
  .hosted-note i { width: 6px; height: 6px; flex: 0 0 auto; margin-top: .33em; border-radius: 50%; background: var(--green); }
  .home-intro, .system-model, .read-next { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 30px; padding: var(--section) var(--gutter); border-bottom: 1px solid var(--line); }
  .home-intro h2, .system-model h2, .demo-showcase h2, .docs-map h2, .read-next h2 { margin: 0; font-size: clamp(1.65rem, 3vw, 2.45rem); font-weight: 640; line-height: 1.08; letter-spacing: -.028em; }
  .home-intro > div > p { max-width: 680px; margin: 30px 0 0; color: var(--muted); font-size: 1rem; line-height: 1.74; }
  .feature-grid { display: grid; grid-template-columns: repeat(4, 1fr); overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); }
  .feature-grid article { min-height: 228px; padding: 26px; border-right: 1px solid var(--line); }
  .feature-grid article:nth-child(4n) { border-right: 0; }
  .feature-grid article:nth-child(-n+4) { border-bottom: 1px solid var(--line); }
  .feature-grid article > span { color: var(--orange); font: 500 .62rem var(--mono); }
  .feature-grid h3 { margin: 26px 0 10px; font-size: .98rem; letter-spacing: -.018em; }
  .feature-grid p { margin: 0; color: var(--muted); font-size: .75rem; line-height: 1.62; }
  .feature-grid code { font-size: .7rem; }
  .demo-showcase { padding: var(--section) var(--gutter); border-bottom: 1px solid var(--line); scroll-margin-top: 32px; }
  .demo-heading { display: grid; grid-template-columns: 1.25fr .75fr; align-items: end; gap: 48px; margin-bottom: 38px; }
  .demo-heading .section-index { margin-bottom: 18px; }
  .demo-heading > p { max-width: 370px; margin: 0; color: var(--muted); font-size: .8rem; line-height: 1.7; }
  .demo-card { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, .55fr); overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: #fff; }
  .demo-preview { position: relative; display: block; min-height: 360px; overflow: hidden; border-right: 1px solid var(--line); background: var(--paper); }
  .demo-preview img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .25s ease; }
  .demo-preview:hover img { transform: scale(1.012); }
  .demo-preview > span { position: absolute; right: 16px; bottom: 16px; display: flex; min-height: 38px; align-items: center; gap: 28px; padding: 0 13px; border: 1px solid #ffffff70; border-radius: 4px; background: #0b1118e8; color: #fff; font-size: .7rem; font-weight: 620; }
  .demo-preview > span i { color: var(--orange); font-style: normal; }
  .demo-copy { display: flex; min-width: 0; flex-direction: column; padding: 26px; }
  .demo-copy > div:first-child { display: flex; align-items: center; justify-content: space-between; color: var(--quiet); font: 500 .6rem var(--mono); }
  .demo-status { display: inline-flex; align-items: center; gap: 7px; }
  .demo-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .demo-copy h3 { margin: 32px 0 11px; font-size: 1.4rem; letter-spacing: -.025em; }
  .demo-copy p { margin: 0; color: var(--muted); font-size: .78rem; line-height: 1.68; }
  .demo-copy ul { display: flex; flex-wrap: wrap; gap: 6px; margin: 24px 0 30px; padding: 0; list-style: none; }
  .demo-copy li { padding: 6px 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--muted); font: 500 .59rem var(--mono); }
  .demo-links { display: grid; gap: 10px; margin-top: auto; padding-top: 18px; border-top: 1px solid var(--line); }
  .demo-links a { width: max-content; max-width: 100%; color: var(--blue); font-size: .69rem; text-decoration: none; }
  .demo-links a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .model-flow { display: flex; align-items: center; gap: 10px; margin: 38px 0; padding: 18px 0; overflow-x: auto; border-block: 1px solid var(--line); white-space: nowrap; }
  .model-flow span { padding: 8px 11px; border: 1px solid var(--line); border-radius: 3px; background: #fff; font: 500 .68rem var(--mono); }
  .model-flow i { color: var(--orange); font-style: normal; }
  .system-model ol { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
  .system-model li { display: grid; grid-template-columns: 110px 1fr; padding: 14px 0; border-bottom: 1px solid var(--line); font-size: .77rem; }
  .system-model li span { color: var(--muted); }
  .docs-map { padding: var(--section) var(--gutter); border-bottom: 1px solid var(--line); }
  .docs-map-heading { display: grid; grid-template-columns: 1.25fr .75fr; align-items: end; gap: 48px; margin-bottom: 48px; }
  .docs-map-heading .section-index { margin-bottom: 18px; }
  .docs-map-heading > p { max-width: 350px; margin: 0; color: var(--muted); font-size: .8rem; line-height: 1.7; }
  .docs-quadrants { display: grid; grid-template-columns: 1fr 1fr; overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); }
  .docs-quadrants a { position: relative; min-height: 232px; padding: 26px 28px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--ink); text-decoration: none; transition: background .14s ease; }
  .docs-quadrants a:nth-child(2n) { border-right: 0; }
  .docs-quadrants a:nth-child(n+3) { border-bottom: 0; }
  .docs-quadrants a:hover { background: var(--paper); }
  .docs-quadrants a > span { color: var(--orange); font: 500 .61rem var(--mono); letter-spacing: .08em; }
  .docs-quadrants strong { display: block; margin-top: 28px; font-size: 1.18rem; letter-spacing: -.022em; }
  .docs-quadrants p { max-width: 350px; margin: 10px 0 0; color: var(--muted); font-size: .75rem; line-height: 1.58; }
  .docs-quadrants i { position: absolute; top: 26px; right: 27px; color: var(--quiet); font: 500 .61rem var(--mono); font-style: normal; }
  .read-next { padding-block: 70px 78px; }
  .read-next > div { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }
  .read-next h2 { font-size: clamp(1.55rem, 3vw, 2.2rem); }
  .read-next a { display: flex; min-width: 210px; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--ink); font-size: .77rem; text-decoration: none; }

  /* Docs */
  .docs-shell { display: grid; grid-template-columns: 200px minmax(0, var(--reading)); gap: clamp(42px, 7vw, 78px); width: min(100%, 1060px); margin-inline: auto; align-items: start; }
  .docs-nav { position: sticky; top: 28px; min-height: 520px; padding-right: 24px; border-right: 1px solid var(--line); }
  .docs-nav > p { margin: 0 0 20px; color: var(--quiet); font: 500 .62rem var(--mono); letter-spacing: .08em; text-transform: uppercase; }
  .docs-nav nav { display: grid; }
  .docs-nav nav a { display: grid; grid-template-columns: 28px 1fr; min-height: 43px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: .75rem; text-decoration: none; }
  .docs-nav nav a span { color: var(--quiet); font: 500 .57rem var(--mono); }
  .docs-nav nav a:hover, .docs-nav nav a.active { background: var(--paper); color: var(--ink); }
  .docs-nav nav a.active { box-shadow: inset 2px 0 var(--orange); }
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

  /* Publisher */
  main.product { padding-top: clamp(36px, 5vw, 56px); }
  .workspace { min-height: calc(100vh - 240px); }
  .file-input { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .empty-state { position: relative; display: grid; grid-template-columns: minmax(300px, .78fr) minmax(390px, 1.22fr); width: min(100%, 1060px); min-height: 520px; margin-inline: auto; overflow: hidden; border-block: 1px solid var(--line); text-align: left; }
  .empty-state::before { position: absolute; inset: 18px; border: 1px solid transparent; content: ""; pointer-events: none; transition: border-color .15s ease, background .15s ease; }
  .empty-state.dragging::before { border-color: var(--orange); background: #f6821f0a; }
  .empty-copy { position: relative; z-index: 1; align-self: center; padding: 48px 0 52px 32px; }
  .empty-state h1, .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1 { margin: 0; font-weight: 640; line-height: 1.04; letter-spacing: -.03em; }
  .empty-state h1 { font-size: clamp(2.6rem, 5vw, 3.7rem); line-height: 1.0; }
  .empty-copy > p:not(.state-label) { max-width: 390px; margin: 24px 0 32px; color: var(--muted); font-size: .98rem; line-height: 1.64; }
  .empty-copy small { display: flex; align-items: center; gap: 8px; margin-top: 18px; color: var(--quiet); font-size: .69rem; }
  .empty-copy small > i, .privacy i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--green); }
  .choose { min-width: 184px; justify-content: space-between; gap: 32px; }
  .brand-stroke { position:relative; align-self:stretch; min-height:480px; margin-right:-24px; overflow:hidden; pointer-events:none; }
  .brand-stroke img { position:absolute; inset:0; width:140%; height:100%; object-fit:cover; object-position:72% 58%; }
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
    .home-hero { min-height:0; align-items:flex-end; padding-top:460px; padding-bottom:56px; }
    .home-hero-copy { width:min(100%,600px); }
    .home-art { top:0; right:auto; bottom:auto; left:-18%; width:138%; height:440px; }
    .home-art img { object-position:64% 72%; }
    .ambient-mark { top:-32px; right:-24px; width:300px; opacity:.1; }
    .paint-pattern { top:170px; right:-18px; bottom:auto; width:300px; grid-template-columns:repeat(2,1fr); gap:24px; opacity:.58; }
    .home-intro, .system-model, .read-next { grid-template-columns: minmax(0, 1fr); gap: 28px; }
    .system-model > div { min-width: 0; }
    .feature-grid { grid-template-columns: repeat(2, 1fr); }
    .feature-grid article:nth-child(2n) { border-right: 0; }
    .feature-grid article:nth-child(n) { border-bottom: 1px solid var(--line); }
    .feature-grid article:nth-last-child(-n+2) { border-bottom: 0; }
    .demo-heading, .docs-map-heading { grid-template-columns: 1fr; gap: 26px; }
    .demo-card { grid-template-columns: 1fr; }
    .demo-preview { min-height: 0; border-right: 0; border-bottom: 1px solid var(--line); aspect-ratio: 16 / 9; }
    .docs-shell { grid-template-columns: 1fr; gap: 40px; }
    .docs-nav { position: static; min-height: 0; padding: 0; border-right: 0; border-bottom: 1px solid var(--line); }
    .docs-nav nav { grid-template-columns: 1fr 1fr; }
    .docs-nav nav a:nth-child(odd) { border-right: 1px solid var(--line); }
    .docs-nav > div { display: none; }
    .empty-state { grid-template-columns: 1fr; }
    .empty-copy { padding: 58px 28px 0; }
    .brand-stroke { min-height:310px; margin:-6px -30px -8px 12%; }
    .brand-stroke img { width:155%; object-position:72% 62%; }
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
    .home-intro, .system-model, .read-next, .demo-showcase, .docs-map { padding: 56px 14px; }
    .demo-card { grid-template-columns: 1fr; }
    .demo-preview { min-height: 0; aspect-ratio: 16 / 9; }
    .demo-copy { padding: 22px; }
    .demo-copy h3 { margin-top: 24px; }
    .model-flow { display:grid; grid-template-columns:minmax(0,1fr); justify-items:stretch; overflow:visible; white-space:normal; }
    .model-flow span { text-align:center; }
    .model-flow i { justify-self:center; transform:rotate(90deg); }
    .feature-grid { grid-template-columns: 1fr; }
    .feature-grid article:nth-child(n) { min-height: 190px; border-right: 0; border-bottom: 1px solid var(--line); }
    .feature-grid article:last-child { border-bottom: 0; }
    .feature-grid h3 { margin-top: 22px; }
    .docs-quadrants { grid-template-columns: 1fr; }
    .docs-quadrants a:nth-child(n) { min-height: 208px; border-right: 0; border-bottom: 1px solid var(--line); }
    .docs-quadrants a:last-child { border-bottom: 0; }
    .read-next > div { align-items: flex-start; flex-direction: column; }
    .docs-nav nav { grid-template-columns: 1fr; }
    .docs-nav nav a:nth-child(odd) { border-right: 0; }
    .doc h1 { font-size: 3rem; }
    .empty-state { min-height: 570px; }
    .empty-copy { padding: 48px 14px 0; }
    .empty-state h1 { font-size: clamp(2.2rem, 12vw, 3rem); }
    .brand-stroke { min-height:260px; margin:0 -34px 0 2%; }
    .brand-stroke img { width:180%; object-position:72% 64%; }
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
