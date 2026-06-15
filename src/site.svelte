<script lang="ts">
  import { onMount } from 'svelte';

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

  let { section = 'home', eyebrow = '' } = $props<{ section: string; eyebrow: string }>();

  let files = $state<File[]>([]);
  let prepared = $state<PreparedFile[]>([]);
  let siteName = $state('');
  let status = $state('');
  let progress = $state(0);
  let publishing = $state(false);
  let publishedUrl = $state('');
  let sites = $state<Site[]>([]);
  let identity = $state('');
  let siteDomain = $state('up.example.com');
  let dragging = $state(false);
  let copied = $state(false);
  let view = $state<'empty' | 'selected' | 'publishing' | 'success' | 'list'>('empty');
  let input = $state<HTMLInputElement>();
  let siteNameInput = $state<HTMLInputElement>();

  const deployUrl =
    'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/inhouse';
  const isProduct = $derived(section === 'app');

  onMount(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
    if (isProduct) void initializeProduct();
  });

  async function initializeProduct() {
    await Promise.all([loadSites(), loadIdentity()]);
    view = sites.length ? 'list' : 'empty';
  }

  async function loadIdentity() {
    try {
      const response = await fetch('/api/me');
      const data = await response.json();
      if (response.ok) identity = data.email;
    } catch {
      identity = '';
    }
  }

  async function loadSites() {
    try {
      const response = await fetch('/api/sites');
      const data = await response.json();
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
        body: JSON.stringify({ manifest }),
      });
      const creation = await created.json();
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
        if (!response.ok) throw new Error((await response.json()).error || 'Upload failed');
      }

      status = 'Verifying deployment';
      progress = 90;
      const activated = await fetch(`/api/deployments/${creation.deployment.id}/activate`, {
        method: 'POST',
      });
      const result = await activated.json();
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
  <a class="wordmark" href="/" aria-label="Up home"><i aria-hidden="true"></i>up</a>
  <nav aria-label="Primary">
    {#if !isProduct}
      <a href="/tutorial">Docs</a>
      <a href="/explanation">How it works</a>
      <a href="/app">Open Up ↗</a>
    {:else}
      <span class="identity"><i aria-hidden="true"></i>{identity}</span>
    {/if}
  </nav>
</header>

<main class:product={isProduct}>
  {#if section === 'home'}
    <div class="home-shell">
      <section class="home-hero" aria-labelledby="home-title">
        <div class="home-kicker"><span>Cloudflare-native</span><i aria-hidden="true"></i><span>Private by default</span></div>
        <h1 id="home-title">Your company’s<br />private web.</h1>
        <p class="home-tagline">Drop a static folder. Get a company-only URL behind the identity system your organization already trusts.</p>
        <div class="home-actions">
          <a class="primary link-button" href="/app">Open Up <span aria-hidden="true">→</span></a>
          <a class="home-secondary" href="/tutorial">Set up your installation</a>
        </div>
        <div class="home-signal" aria-hidden="true">
          <span class="signal-navy"></span><span class="signal-blue"></span><span class="signal-cyan"></span><span class="signal-red"></span><span class="signal-orange"></span>
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
        <article><span>01</span><h3>Choose a folder</h3><p>HTML, CSS, JavaScript, and assets. No framework or build system required.</p></article>
        <article><span>02</span><h3>Publish atomically</h3><p>Every digest is verified before a deployment becomes visible. Partial updates never leak.</p></article>
        <article><span>03</span><h3>Share inside</h3><p>Each site receives a sibling hostname and inherits the organization’s Access boundary.</p></article>
        <article><span>04</span><h3>Stay in control</h3><p>The Worker, Durable Object, R2 bucket, DNS, and Access app remain in your account.</p></article>
      </section>

      <section class="system-model" aria-labelledby="model-title">
        <p class="section-index">02 / SYSTEM</p>
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
        <div class="docs-map-heading"><div><p class="section-index">03 / DOCUMENTATION</p><h2 id="docs-title">Read for the job at hand.</h2></div><p>Up follows Diátaxis: learning, goals, information, and understanding stay distinct.</p></div>
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
            <h1>Put it up.</h1>
            <p>Drop a static folder. Up gives it a company-only URL.</p>
            <button class="primary choose" onclick={chooseFolder}>Choose a folder <span aria-hidden="true">↗</span></button>
            <small><i aria-hidden="true"></i> Protected by Cloudflare Access</small>
          </div>
          <div class="brand-stroke" aria-hidden="true">
            <svg viewBox="0 0 760 390" role="presentation">
              <defs>
                <filter id="paint" x="-20%" y="-20%" width="140%" height="140%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.012 0.09" numOctaves="2" seed="12" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" />
                </filter>
              </defs>
              <g fill="none" stroke-linecap="round" filter="url(#paint)">
                <path class="stroke navy" d="M74 311 C184 268 237 102 410 98 C523 96 594 175 697 64" />
                <path class="stroke cobalt" d="M52 333 C201 302 249 151 397 126 C515 106 591 183 702 94" />
                <path class="stroke coral" d="M126 350 C269 327 323 219 445 180 C566 142 642 180 731 122" />
                <path class="stroke orange" d="M154 363 C304 329 366 240 471 207 C585 171 661 193 742 147" />
                <path class="stroke cyan" d="M95 325 C225 277 289 177 407 149 C498 128 570 160 639 124" />
              </g>
              <g fill="none" stroke-linecap="round" opacity=".52">
                <path class="bristle blue" d="M64 341 C210 290 269 157 411 127 C520 104 601 170 716 87" />
                <path class="bristle red" d="M145 373 C296 337 357 250 478 213 C589 180 666 197 747 151" />
                <path class="bristle white" d="M126 335 C248 293 318 199 430 171" />
              </g>
            </svg>
          </div>
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
                <div><span>{site.owner}</span><small>{site.activeDeploymentId ? 'Published' : 'Pending'}</small></div>
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
          <p class="privacy"><i></i> Private to your organization</p>
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
          <h1>It’s up.</h1>
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
        <h1>Operate Up</h1><p class="summary">Keep the publishing plane small and the trust boundary intact.</p><h2>Update a site</h2><p>Publish the same site name. Up activates the replacement only after every asset passes verification.</p><h2>Use a coding agent</h2><pre><code>Build a static site into ./dist.
Keep secrets out of browser code.
Publish the folder through Up.</code></pre><h2>Respond to exposure</h2><p>Disable the wildcard route or deny the Access application first. Never enable a public Worker hostname as a workaround.</p>
      {:else if section === 'reference'}
        <h1>Reference</h1><p class="summary">Exact contracts for version 0.0.1.</p><table><tbody><tr><th><code>GET /app</code></th><td>Authenticated publisher</td></tr><tr><th><code>GET /api/sites</code></th><td>List sites</td></tr><tr><th><code>POST /api/sites/:name/deployments</code></th><td>Create deployment</td></tr><tr><th><code>PUT /api/deployments/:id/assets</code></th><td>Verify and store asset</td></tr><tr><th><code>POST /api/deployments/:id/activate</code></th><td>Atomic activation</td></tr></tbody></table><h2>Limits</h2><ul><li>500 files</li><li>10 MiB per file</li><li>50 MiB total</li><li><code>index.html</code> required</li></ul>
      {:else if section === 'explanation'}
        <h1>The boundary is the product.</h1><p class="summary">One installation gives a company a private place for small web software.</p><h2>Privacy is ambient</h2><p>There is no public mode or privacy checkbox. Every site inherits the organization’s Access identity boundary.</p><h2>Content stays separate</h2><p>Generated JavaScript runs on sibling site hostnames and receives no Worker bindings or secrets. Control mutations require exact-origin requests.</p><h2>Deployment is atomic</h2><p>Files remain pending in private R2 until every manifest digest is verified. Visitors never see a partial update.</p>
      {:else if section === 'offline'}
        <h1>You are offline.</h1><p class="summary">The documentation shell is cached. Publishing still requires the network and Access.</p>
      {:else}
        <h1>Page not found.</h1><p class="summary">The requested page does not exist.</p><a href="/">Return to Up</a>
      {/if}
      </article>
    </div>
  {/if}
</main>

<footer><span>Up 0.0.1 · Private by default</span><nav><a href="/tutorial">Setup</a><a href="/reference">Reference</a><a href="https://github.com/acoyfellow/inhouse">GitHub</a></nav></footer>

<style>
  :global(:root){color-scheme:light;--white:#fff;--canvas:#f7f7f5;--ink:#171717;--muted:#6b6b66;--quiet:#70706a;--line:#deded9;--line-dark:#c8c8c1;--orange:#f6821f;--orange-hover:#e87416;--blue:#2678a4;--green:#16835b;--red:#b83825;--sans:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;--mono:"IBM Plex Mono",ui-monospace,monospace}:global(*){box-sizing:border-box}:global(html){background:var(--white)}:global(body){min-width:320px;margin:0;background:var(--white);color:var(--ink);font-family:var(--sans);font-synthesis:none}:global(button),:global(input){font:inherit}:global(a){color:inherit}:global(code),:global(pre){font-family:var(--mono)}:global(::selection){background:#f6821f33}
  header,main,footer{width:min(100%,1120px);margin-inline:auto;padding-inline:32px}header{height:68px;display:flex;align-items:center;border-bottom:1px solid var(--line)}.wordmark{font-size:.9rem;font-weight:700;letter-spacing:-.025em;text-decoration:none}header nav{display:flex;align-items:center;gap:24px;margin-left:auto;color:var(--muted);font-size:.72rem}header nav a{text-decoration:none}header nav a:hover{color:var(--ink)}header nav span{font-family:var(--mono);font-size:.64rem}main{min-height:calc(100vh - 130px);padding-top:72px;padding-bottom:100px}.workspace{min-height:560px;display:grid;align-items:center}.empty-state{max-width:520px;margin:auto;text-align:center;padding:80px 40px;border:1px solid transparent;transition:border-color .12s,background .12s}.empty-state.dragging{border-color:var(--orange);background:#fffaf5}.state-label{margin:0 0 14px;color:var(--quiet);font:500 .65rem/1 var(--mono);letter-spacing:.04em;text-transform:uppercase}.empty-state h1,.selected-view h1,.publishing-view h1,.success-view h1,.view-heading h1,.doc h1{margin:0;letter-spacing:-.045em}.empty-state h1{font-size:2rem;font-weight:600}.empty-copy>p:not(.state-label){margin:12px 0 28px;color:var(--muted);font-size:.95rem}.empty-state small{display:block;margin-top:18px;color:var(--quiet);font-size:.7rem}.primary,.secondary,.link-button{display:inline-flex;min-height:40px;align-items:center;justify-content:center;padding:0 16px;border:1px solid;border-radius:3px;font-size:.78rem;font-weight:600;text-decoration:none;cursor:pointer}.primary{border-color:var(--orange);background:var(--orange);color:#211005}.primary:hover{border-color:var(--orange-hover);background:var(--orange-hover)}.primary:disabled{opacity:.45;cursor:not-allowed}.secondary{border-color:var(--line-dark);background:var(--white);color:var(--ink)}.secondary:hover{border-color:var(--ink)}.small{min-height:34px;padding-inline:13px}.file-input{position:fixed;width:1px;height:1px;opacity:0;pointer-events:none}.selected-view,.publishing-view,.success-view,.list-view{width:min(100%,720px);margin:auto}.back{margin-bottom:56px;padding:0;border:0;background:none;color:var(--muted);font-size:.75rem;cursor:pointer}.back:hover{color:var(--ink)}.selected-view h1,.publishing-view h1,.success-view h1,.view-heading h1{font-size:2rem;font-weight:600}.file-summary{margin:38px 0 44px;border-top:1px solid var(--line)}.file-summary div{display:grid;grid-template-columns:1fr 1fr;padding:14px 0;border-bottom:1px solid var(--line)}dt{color:var(--muted);font-size:.75rem}dd{margin:0;text-align:right;font:500 .72rem var(--mono)}dd.valid{color:var(--green)}.address{display:grid;gap:10px}.address>span{font-size:.72rem;font-weight:600}.address>div{display:flex;align-items:center;border:1px solid var(--line-dark);border-radius:3px;overflow:hidden}.address input{min-width:0;flex:1;height:44px;padding:0 12px;border:0;outline:none;font-family:var(--mono);font-size:.78rem}.address input:focus{box-shadow:inset 0 0 0 1px var(--blue)}.address em{padding-right:12px;color:var(--quiet);font:400 .7rem var(--mono);font-style:normal}.privacy{display:flex;align-items:center;gap:8px;margin:18px 0 50px;color:var(--muted);font-size:.72rem}.privacy i{width:7px;height:7px;border-radius:50%;background:var(--green)}.footer-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:18px;border-top:1px solid var(--line)}.steps{margin:42px 0 34px}.steps div{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line);font-size:.78rem}.steps b{font:500 .68rem var(--mono)}.progress{height:2px;background:var(--line)}.progress i{display:block;height:100%;background:var(--orange);transition:width .2s}.progress-number{margin:9px 0 40px;text-align:right;color:var(--muted);font:500 .65rem var(--mono)}.publishing-view>small{color:var(--quiet);font-size:.72rem}.state-label.success{color:var(--green)}.published-url{display:block;margin:28px 0;color:var(--blue);font:500 .85rem var(--mono);text-decoration:none;word-break:break-all}.success-actions{display:flex;align-items:center;gap:22px}.text-link,.text-button{color:var(--blue);font-size:.76rem;text-decoration:none}.text-button{padding:0;border:0;background:none;cursor:pointer}.receipt{margin:52px 0 36px;border-top:1px solid var(--line)}.receipt div{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--line)}.receipt dd{font-family:var(--sans)}.view-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:42px}.site-list{border-top:1px solid var(--line)}.site-list article{display:grid;grid-template-columns:1fr auto;gap:20px;padding:20px 0;border-bottom:1px solid var(--line)}.site-list article>div{display:grid;gap:6px}.site-list article>div:last-child{text-align:right}.site-list strong{font-size:.85rem}.site-list code,.site-list span,.site-list small{color:var(--muted);font-size:.66rem}.doc{width:min(100%,720px);margin:auto}.doc h1{font-size:2.4rem;font-weight:600}.summary{max-width:620px;margin:16px 0 50px;color:var(--muted);font-size:1rem;line-height:1.65}.doc h2{margin:46px 0 12px;font-size:1rem}.doc p,.doc li{color:var(--muted);font-size:.83rem;line-height:1.7}.doc pre{margin:18px 0;padding:16px;border:1px solid var(--line);background:var(--canvas);overflow:auto;font-size:.72rem;line-height:1.7}.doc table{width:100%;border-collapse:collapse}.doc th,.doc td{padding:14px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:.75rem}.doc th{width:52%;font-weight:500}.doc td{color:var(--muted)}footer{display:flex;align-items:center;min-height:62px;border-top:1px solid var(--line);color:var(--quiet);font:500 .62rem var(--mono)}footer nav{display:flex;gap:20px;margin-left:auto}footer a{text-decoration:none}
  @media(max-width:700px){header,main,footer{padding-inline:20px}header nav a:not(:last-child){display:none}main{padding-top:38px}.workspace{min-height:510px}.empty-state{padding:60px 10px}.selected-view,.publishing-view,.success-view,.list-view{width:100%}.back{margin-bottom:38px}.address>div{display:grid}.address em{padding:0 12px 11px}.footer-actions{display:grid;grid-template-columns:1fr 1fr}.site-list article{grid-template-columns:1fr}.site-list article>div:last-child{text-align:left}.view-heading{align-items:flex-start}.doc h1{font-size:2rem}footer nav a:first-child{display:none}}
  /* Up — white-space-first institutional shell with one expressive brand gesture. */
  :global(:root){
    --white:#fff;
    --canvas:#f6f6f2;
    --ink:#101114;
    --muted:#5e6269;
    --quiet:#777b82;
    --line:#dedfd9;
    --line-dark:#b9bbb4;
    --orange:#ff6b20;
    --orange-hover:#ee5712;
    --blue:#1569d8;
    --navy:#071d49;
    --cyan:#16b9e7;
    --green:#16835b;
    --red:#ed2939;
  }
  :global(body){background:linear-gradient(180deg,#fff 0%,#fefefd 72%,#fafaf7 100%)}
  header,main,footer{width:min(100%,1240px);padding-inline:40px}
  header{height:72px;border-color:#e6e7e2}
  .wordmark{display:inline-flex;align-items:center;gap:9px;font-size:1.05rem;font-weight:760;letter-spacing:-.045em}
  .wordmark>i{width:11px;height:11px;border-radius:50%;background:var(--orange);box-shadow:7px -5px 0 -3px var(--cyan)}
  header nav{gap:28px;font-size:.75rem}
  header nav a{transition:color .16s ease}
  .identity{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted)}
  .identity>i{width:6px;height:6px;border-radius:50%;background:var(--green)}
  main{min-height:calc(100vh - 140px);padding-top:56px;padding-bottom:92px}
  .workspace{min-height:610px}
  .empty-state{position:relative;display:grid;grid-template-columns:minmax(330px,.78fr) minmax(440px,1.22fr);align-items:center;width:min(100%,1080px);max-width:none;min-height:540px;margin:auto;padding:0;text-align:left;border-block:1px solid var(--line);overflow:hidden}
  .empty-state::before{position:absolute;inset:20px;border:1px solid transparent;content:"";pointer-events:none;transition:border-color .2s ease,background .2s ease}
  .empty-state.dragging::before{border-color:var(--orange);background:#ff6b2008}
  .empty-copy{position:relative;z-index:2;padding:60px 0 64px 40px}
  .state-label{margin-bottom:18px;color:#6f737a;font-size:.64rem;letter-spacing:.1em}
  .empty-state h1{font-size:clamp(4.5rem,8vw,7rem);font-weight:610;line-height:.84;letter-spacing:-.075em}
  .empty-copy>p:not(.state-label){max-width:390px;margin:27px 0 34px;color:var(--muted);font-size:1.04rem;line-height:1.65}
  .empty-copy small{display:flex;align-items:center;gap:9px;margin-top:20px;color:var(--quiet);font-size:.7rem}
  .empty-copy small>i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px #16835b12}
  .brand-stroke{position:relative;align-self:stretch;min-height:500px;margin-right:-20px;pointer-events:none}
  .brand-stroke::after{position:absolute;right:3%;bottom:9%;width:64%;height:14px;background:radial-gradient(ellipse,#0f173324 0%,transparent 70%);filter:blur(8px);content:""}
  .brand-stroke svg{position:absolute;inset:3% -3% 0 -9%;width:112%;height:100%;overflow:visible;transform:rotate(-3deg)}
  .stroke{stroke-width:72}
  .stroke.navy{stroke:var(--navy)}
  .stroke.cobalt{stroke:#1451bb;stroke-width:58}
  .stroke.coral{stroke:#ed2347;stroke-width:66}
  .stroke.orange{stroke:var(--orange);stroke-width:44}
  .stroke.cyan{stroke:var(--cyan);stroke-width:24}
  .bristle{stroke-width:5}
  .bristle.blue{stroke:#72d9f2}
  .bristle.red{stroke:#ffb068}
  .bristle.white{stroke:#fff;stroke-width:7}
  .primary,.secondary,.link-button{min-height:44px;padding:0 19px;border-radius:5px;font-size:.78rem;transition:transform .15s ease,box-shadow .15s ease,background .15s ease}
  .primary{border-color:var(--orange);background:var(--orange);color:#1d1009;box-shadow:0 1px 0 #ca3d05}
  .primary:hover{transform:translateY(-1px);box-shadow:0 5px 16px #ff6b2026}
  .choose{gap:36px;min-width:184px;justify-content:space-between}
  .choose span{font-size:1rem}
  .secondary{border-color:var(--line-dark)}
  .selected-view,.publishing-view,.success-view,.list-view{width:min(100%,780px)}
  .selected-view,.publishing-view,.success-view{position:relative;padding-left:32px;border-left:3px solid var(--orange)}
  .back{margin-bottom:64px;font-family:var(--mono);font-size:.68rem}
  .selected-view h1,.publishing-view h1,.success-view h1,.view-heading h1{font-size:clamp(2.8rem,5vw,4.3rem);font-weight:610;line-height:.98;letter-spacing:-.06em}
  .file-summary{display:grid;grid-template-columns:repeat(3,1fr);margin:48px 0;border-block:1px solid var(--line)}
  .file-summary div{display:flex;min-height:88px;flex-direction:column;justify-content:space-between;padding:16px 18px;border-right:1px solid var(--line);border-bottom:0}
  .file-summary div:first-child{padding-left:0}
  .file-summary div:last-child{border-right:0}
  .file-summary dd{text-align:left;font-size:.74rem}
  .address{gap:12px}
  .address>span{font-size:.73rem;letter-spacing:.01em}
  .address>div{height:52px;border-color:var(--line-dark);border-radius:5px;background:#fff;transition:border-color .15s ease,box-shadow .15s ease}
  .address>div:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px #1569d812}
  .address input{height:50px;padding-left:16px;font-size:.86rem}
  .address input:focus{box-shadow:none}
  .address em{font-size:.74rem}
  .address>small{color:var(--quiet);font-size:.67rem;line-height:1.5}
  :global(a:focus-visible),:global(button:focus-visible),:global(input:focus-visible){outline:3px solid #16b9e766;outline-offset:3px}
  .privacy{width:max-content;margin:18px 0 52px;padding:7px 10px;border:1px solid #dce8df;border-radius:999px;background:#f8fcf9;color:#496052}
  .footer-actions{padding-top:22px}
  .steps{margin:50px 0 38px;border-top:1px solid var(--line)}
  .steps div{position:relative;padding:15px 0 15px 28px}
  .steps div::before{position:absolute;left:1px;top:50%;width:7px;height:7px;border:2px solid var(--line-dark);border-radius:50%;background:#fff;content:"";transform:translateY(-50%)}
  .progress{height:4px;border-radius:99px;overflow:hidden}
  .progress i{background:linear-gradient(90deg,var(--navy),var(--cyan),var(--orange))}
  .success-view::after{position:absolute;top:-16px;right:0;width:122px;height:9px;background:linear-gradient(90deg,var(--navy) 0 32%,var(--cyan) 32% 52%,var(--orange) 52% 100%);content:"";transform:skewX(-26deg)}
  .state-label.success{color:var(--green)}
  .published-url{margin:28px 0 32px;color:var(--blue);font-size:.9rem}
  .success-actions{gap:24px}
  .receipt{margin-top:56px}
  .receipt div{padding:15px 0}
  .view-heading{margin-bottom:46px}
  .site-list{border-color:var(--line-dark)}
  .site-list article{padding:24px 4px;transition:background .14s ease}
  .site-list article:hover{background:#f8f8f5}
  .site-list strong{font-size:.96rem}
  .site-list a{width:max-content;color:var(--muted);text-decoration:none}
  .site-list a:hover{text-decoration:underline;text-underline-offset:3px}
  .doc{width:min(100%,780px)}
  .doc h1{font-size:clamp(3rem,7vw,5.5rem);font-weight:610;line-height:.95;letter-spacing:-.065em}
  .summary{font-size:1.08rem}
  /* Product front door: Unsurf-style clarity, organised around Diátaxis. */
  .home-shell{width:min(100%,1120px);margin:auto}
  .home-hero{position:relative;min-height:590px;padding:106px 42px 86px;border-block:1px solid var(--line);overflow:hidden}
  .home-kicker{display:flex;align-items:center;gap:10px;color:var(--quiet);font:500 .66rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .home-kicker i{width:5px;height:5px;border-radius:50%;background:var(--orange)}
  .home-hero h1{max-width:900px;margin:31px 0 26px;font-size:clamp(5.5rem,10vw,8.5rem);font-weight:610;line-height:.82;letter-spacing:-.08em}
  .home-tagline{max-width:650px;margin:0;color:var(--muted);font-size:1.14rem;line-height:1.65}
  .home-actions{display:flex;align-items:center;gap:28px;margin-top:36px}
  .home-actions .primary{min-width:134px;justify-content:space-between;gap:28px}
  .home-secondary{color:var(--muted);font-size:.78rem;text-decoration:none;border-bottom:1px solid var(--line-dark);padding-block:10px 7px}
  .home-secondary:hover{color:var(--ink);border-color:var(--ink)}
  .home-signal{position:absolute;right:-26px;bottom:39px;width:470px;height:106px;transform:rotate(-7deg)}
  .home-signal span{position:absolute;right:0;height:20px;border-radius:999px;transform-origin:right center;filter:saturate(1.08)}
  .signal-navy{top:0;width:94%;background:var(--navy);transform:rotate(-1deg)}
  .signal-blue{top:19px;width:83%;background:#1451bb;transform:rotate(1deg)}
  .signal-cyan{top:38px;width:68%;height:12px!important;background:var(--cyan);transform:rotate(-2deg)}
  .signal-red{top:54px;width:76%;background:#f21f49;transform:rotate(2deg)}
  .signal-orange{top:74px;width:64%;background:var(--orange);transform:rotate(-1deg)}
  .section-index{margin:0;color:var(--quiet);font:500 .64rem var(--mono);letter-spacing:.08em}
  .home-intro,.system-model,.read-next{display:grid;grid-template-columns:220px 1fr;padding:98px 42px;border-bottom:1px solid var(--line)}
  .home-intro h2,.system-model h2,.docs-map h2,.read-next h2{margin:0;font-size:clamp(2.7rem,5vw,4.9rem);font-weight:610;line-height:.96;letter-spacing:-.06em}
  .home-intro>div>p{max-width:680px;margin:34px 0 0;color:var(--muted);font-size:1.02rem;line-height:1.75}
  .feature-grid{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}
  .feature-grid article{min-height:250px;padding:29px 27px;border-right:1px solid var(--line)}
  .feature-grid article:last-child{border-right:0}
  .feature-grid article>span{color:var(--orange);font:500 .63rem var(--mono)}
  .feature-grid h3{margin:72px 0 13px;font-size:1rem;letter-spacing:-.025em}
  .feature-grid p{margin:0;color:var(--muted);font-size:.77rem;line-height:1.65}
  .system-model>div{min-width:0}
  .model-flow{display:flex;align-items:center;gap:12px;margin:42px 0;padding:20px 0;border-block:1px solid var(--line);overflow:auto;white-space:nowrap}
  .model-flow span{padding:9px 12px;border:1px solid var(--line);border-radius:4px;background:#fff;font:500 .69rem var(--mono)}
  .model-flow i{color:var(--orange);font-style:normal}
  .system-model ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
  .system-model li{display:grid;grid-template-columns:120px 1fr;padding:14px 0;border-bottom:1px solid var(--line);font-size:.78rem}
  .system-model li span{color:var(--muted)}
  .docs-map{padding:98px 42px;border-bottom:1px solid var(--line)}
  .docs-map-heading{display:grid;grid-template-columns:1.3fr .7fr;align-items:end;gap:50px;margin-bottom:54px}
  .docs-map-heading .section-index{margin-bottom:20px}
  .docs-map-heading>p{max-width:350px;margin:0;color:var(--muted);font-size:.81rem;line-height:1.7}
  .docs-quadrants{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line-dark)}
  .docs-quadrants a{position:relative;min-height:250px;padding:27px 30px;color:var(--ink);text-decoration:none;border-right:1px solid var(--line);border-bottom:1px solid var(--line);transition:background .14s ease}
  .docs-quadrants a:nth-child(2n){border-right:0}
  .docs-quadrants a:nth-child(n+3){border-bottom:0}
  .docs-quadrants a:hover{background:#f7f7f3}
  .docs-quadrants a>span{color:var(--orange);font:500 .62rem var(--mono);letter-spacing:.08em}
  .docs-quadrants strong{display:block;margin-top:68px;font-size:1.65rem;letter-spacing:-.045em}
  .docs-quadrants p{max-width:350px;margin:11px 0 0;color:var(--muted);font-size:.76rem;line-height:1.6}
  .docs-quadrants i{position:absolute;top:27px;right:28px;color:var(--quiet);font:500 .63rem var(--mono);font-style:normal}
  .read-next{padding-block:72px 84px}
  .read-next>div{display:flex;align-items:flex-end;justify-content:space-between;gap:30px}
  .read-next h2{font-size:clamp(2.4rem,4vw,3.8rem)}
  .read-next a{display:flex;min-width:210px;justify-content:space-between;padding:15px 0;color:var(--ink);font-size:.78rem;text-decoration:none;border-bottom:1px solid var(--ink)}
  /* Persistent documentation frame inspired by Diátaxis' task-first map. */
  .docs-shell{display:grid;grid-template-columns:220px minmax(0,780px);gap:82px;width:min(100%,1082px);margin:auto;align-items:start}
  .docs-nav{position:sticky;top:28px;min-height:560px;padding-right:26px;border-right:1px solid var(--line)}
  .docs-nav>p{margin:0 0 24px;color:var(--quiet);font:500 .62rem var(--mono);letter-spacing:.08em;text-transform:uppercase}
  .docs-nav nav{display:grid}
  .docs-nav nav a{display:grid;grid-template-columns:28px 1fr;padding:12px 8px;color:var(--muted);font-size:.76rem;text-decoration:none;border-bottom:1px solid var(--line)}
  .docs-nav nav a span{color:var(--quiet);font:500 .57rem var(--mono)}
  .docs-nav nav a:hover,.docs-nav nav a.active{color:var(--ink);background:#f7f7f3}
  .docs-nav nav a.active{box-shadow:inset 2px 0 var(--orange)}
  .docs-nav>div{display:grid;gap:8px;margin-top:32px;padding:14px 8px;border-top:1px solid var(--line);font:500 .62rem var(--mono)}
  .docs-nav>div span{color:var(--quiet)}
  .docs-nav>div a{color:var(--blue);text-decoration:none}
  .docs-shell .doc{width:100%;margin:0;padding-bottom:80px}
  .docs-shell .doc>h1{max-width:760px}
  .docs-shell .doc .summary{border-bottom:1px solid var(--line);padding-bottom:42px}
  .docs-shell .doc h2{margin-top:58px;padding-top:17px;border-top:1px solid var(--line);font-size:1.05rem}
  footer{min-height:68px;border-color:#e2e3de}
  @media(max-width:820px){
    header,main,footer{padding-inline:24px}
    main{padding-top:36px}
    .empty-state{grid-template-columns:1fr;min-height:650px}
    .empty-copy{padding:64px 28px 0}
    .empty-state h1{font-size:clamp(4rem,18vw,6rem)}
    .brand-stroke{min-height:310px;margin:-10px -30px -10px 22%}
    .brand-stroke svg{inset:-9% -8% 0 -15%;width:120%}
    .file-summary{grid-template-columns:1fr}
    .file-summary div,.file-summary div:first-child{min-height:58px;flex-direction:row;align-items:center;padding:13px 0;border-right:0;border-bottom:1px solid var(--line)}
    .file-summary div:last-child{border-bottom:0}
    .selected-view,.publishing-view,.success-view{padding-left:20px}
    .home-hero{min-height:640px;padding:78px 28px 190px}
    .home-hero h1{font-size:clamp(4.8rem,15vw,7rem)}
    .home-signal{right:-60px;bottom:42px;width:430px}
    .home-intro,.system-model,.read-next{grid-template-columns:1fr;gap:32px;padding:72px 28px}
    .feature-grid{grid-template-columns:1fr 1fr}
    .feature-grid article:nth-child(2){border-right:0}
    .feature-grid article:nth-child(-n+2){border-bottom:1px solid var(--line)}
    .docs-map{padding:72px 28px}
    .docs-map-heading{grid-template-columns:1fr;gap:28px}
    .docs-shell{grid-template-columns:1fr;gap:42px}
    .docs-nav{position:static;min-height:0;padding:0;border-right:0;border-bottom:1px solid var(--line)}
    .docs-nav nav{grid-template-columns:1fr 1fr}
    .docs-nav nav a:nth-child(odd){border-right:1px solid var(--line)}
    .docs-nav>div{display:none}
  }
  @media(max-width:560px){
    header,main,footer{padding-inline:18px}
    header nav{gap:15px}
    header nav a:not(:last-child){display:none}
    main{padding-bottom:64px}
    .workspace{min-height:540px}
    .empty-state{min-height:590px}
    .empty-copy{padding:52px 14px 0}
    .empty-copy>p:not(.state-label){font-size:.94rem}
    .brand-stroke{min-height:265px;margin:-4px -34px 0 12%}
    .back{margin-bottom:44px}
    .selected-view h1,.publishing-view h1,.success-view h1,.view-heading h1{font-size:2.75rem}
    .address>div{display:grid;height:auto}
    .address em{padding:0 16px 12px}
    .footer-actions{grid-template-columns:1fr 1.4fr}
    .footer-actions>*{width:100%}
    .identity{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .home-hero{min-height:600px;padding:62px 14px 180px}
    .home-hero h1{margin-top:26px;font-size:clamp(3.45rem,16vw,4.5rem)}
    .home-tagline{font-size:.96rem}
    .home-actions{align-items:flex-start;flex-direction:column;gap:12px}
    .home-signal{right:-120px;bottom:34px;width:440px}
    .home-intro,.system-model,.read-next{padding:58px 14px}
    .feature-grid{grid-template-columns:1fr}
    .feature-grid article{min-height:205px;border-right:0;border-bottom:1px solid var(--line)}
    .feature-grid article:nth-child(n){border-right:0;border-bottom:1px solid var(--line)}
    .feature-grid article:last-child{border-bottom:0}
    .feature-grid h3{margin-top:50px}
    .docs-map{padding:58px 14px}
    .docs-quadrants{grid-template-columns:1fr}
    .docs-quadrants a:nth-child(n){min-height:220px;border-right:0;border-bottom:1px solid var(--line)}
    .docs-quadrants a:last-child{border-bottom:0}
    .read-next>div{align-items:flex-start;flex-direction:column}
    .docs-nav nav{grid-template-columns:1fr}
    .docs-nav nav a:nth-child(odd){border-right:0}
    .docs-shell .doc h1{font-size:3rem}
    footer nav a:first-child{display:none}
  }
  @media(prefers-reduced-motion:reduce){:global(*){transition:none!important}.brand-stroke svg{transform:none}}
</style>
