<script lang="ts">
  import { onMount } from 'svelte';
  import PaintSwash from './paint-swash.svelte';

  type Visibility = 'company' | 'restricted' | 'public';
  type ReaderRule = { type: 'email' | 'domain' | 'group'; value: string };
  type Site = {
    name: string;
    owner: string;
    updatedAt?: string;
    activeDeploymentId?: string;
    access?: { visibility: Visibility; readers: ReaderRule[] };
    databaseEnabled?: boolean;
    runtimeEnabled?: boolean;
  };

  type SecretSummary = { name: string; allowedHosts: string[]; updatedAt: string };
  type ScheduleSummary = {
    id: string;
    path: string;
    cron: string;
    status: 'enabled' | 'paused' | 'disabled';
    maxRunsPerDay: number;
    retryLimit: number;
    nextRunAt: string;
    lastStatus?: 'success' | 'failed';
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
  let visibility = $state<Visibility>('company');
  let readersText = $state('');
  let publicConfirmed = $state(false);
  let databaseRequested = $state(false);
  let view = $state<'empty' | 'selected' | 'publishing' | 'success' | 'list' | 'manage'>('empty');
  let managedSite = $state<Site | null>(null);
  let managedSecrets = $state<SecretSummary[]>([]);
  let managedSchedules = $state<ScheduleSummary[]>([]);
  let managedVisibility = $state<Visibility>('company');
  let managedReaders = $state('');
  let secretName = $state('');
  let secretValue = $state('');
  let secretHosts = $state('');
  let schedulePath = $state('/api/jobs/run');
  let scheduleCron = $state('0 * * * *');
  let manageStatus = $state('');
  let input = $state<HTMLInputElement>();
  let siteNameInput = $state<HTMLInputElement>();

  const deployUrl =
    'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/up';
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

  async function openManagement(site: Site) {
    managedSite = site;
    managedVisibility = site.access?.visibility || 'company';
    managedReaders = (site.access?.readers || [])
      .map((rule) => (rule.type === 'group' ? `group:${rule.value}` : rule.type === 'domain' ? `@${rule.value}` : rule.value))
      .join(', ');
    manageStatus = '';
    view = 'manage';
    await loadManagement();
  }

  async function loadManagement() {
    if (!managedSite) return;
    const name = encodeURIComponent(managedSite.name);
    const [secretsResponse, schedulesResponse, sitesResponse] = await Promise.all([
      fetch(`/api/sites/${name}/secrets`),
      fetch(`/api/sites/${name}/schedules`),
      fetch('/api/sites'),
    ]);
    if (secretsResponse.ok) managedSecrets = (await secretsResponse.json()).secrets;
    if (schedulesResponse.ok) managedSchedules = (await schedulesResponse.json()).schedules;
    if (sitesResponse.ok) {
      const data = await sitesResponse.json();
      sites = data.sites;
      managedSite = sites.find((site) => site.name === managedSite?.name) || managedSite;
    }
  }

  async function saveManagedAccess() {
    if (!managedSite) return;
    const readers = parseReaders(managedReaders);
    if (managedVisibility === 'restricted' && !readers.length) {
      manageStatus = 'Restricted sites require at least one reader.';
      return;
    }
    const response = await fetch(`/api/sites/${encodeURIComponent(managedSite.name)}/access`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access: {
          visibility: managedVisibility,
          readers: managedVisibility === 'restricted' ? readers : [],
        },
      }),
    });
    const data = await response.json();
    manageStatus = response.ok ? 'Visibility saved.' : data.error || 'Unable to save visibility.';
    if (response.ok) await loadManagement();
  }

  async function toggleManagedDatabase() {
    if (!managedSite) return;
    const enabled = !managedSite.databaseEnabled;
    const response = await fetch(`/api/sites/${encodeURIComponent(managedSite.name)}/database`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json();
    manageStatus = response.ok
      ? enabled
        ? 'Database enabled.'
        : 'Database deleted.'
      : data.error || 'Unable to update database.';
    if (response.ok) await loadManagement();
  }

  async function saveSecret() {
    if (!managedSite || !secretName || !secretValue || !secretHosts) return;
    const response = await fetch(
      `/api/sites/${encodeURIComponent(managedSite.name)}/secrets/${encodeURIComponent(secretName)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: secretValue,
          allowedHosts: secretHosts.split(/[\n,]/).map((host) => host.trim()).filter(Boolean),
        }),
      },
    );
    const data = await response.json();
    manageStatus = response.ok ? 'Secret capability saved.' : data.error || 'Unable to save secret.';
    if (response.ok) {
      secretName = '';
      secretValue = '';
      secretHosts = '';
      await loadManagement();
    }
  }

  async function deleteSecret(name: string) {
    if (!managedSite) return;
    const response = await fetch(
      `/api/sites/${encodeURIComponent(managedSite.name)}/secrets/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    manageStatus = response.ok ? 'Secret capability deleted.' : 'Unable to delete secret.';
    if (response.ok) await loadManagement();
  }

  async function addSchedule() {
    if (!managedSite) return;
    const response = await fetch(`/api/sites/${encodeURIComponent(managedSite.name)}/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: schedulePath,
        cron: scheduleCron,
        maxRunsPerDay: 24,
        retryLimit: 3,
      }),
    });
    const data = await response.json();
    manageStatus = response.ok ? 'Schedule created.' : data.error || 'Unable to create schedule.';
    if (response.ok) await loadManagement();
  }

  async function updateSchedule(item: ScheduleSummary, status: ScheduleSummary['status']) {
    if (!managedSite) return;
    const response = await fetch(
      `/api/sites/${encodeURIComponent(managedSite.name)}/schedules/${item.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    manageStatus = response.ok ? `Schedule ${status}.` : 'Unable to update schedule.';
    if (response.ok) await loadManagement();
  }

  async function deleteSchedule(id: string) {
    if (!managedSite) return;
    const response = await fetch(
      `/api/sites/${encodeURIComponent(managedSite.name)}/schedules/${id}`,
      { method: 'DELETE' },
    );
    manageStatus = response.ok ? 'Schedule deleted.' : 'Unable to delete schedule.';
    if (response.ok) await loadManagement();
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
    visibility = 'company';
    readersText = '';
    publicConfirmed = false;
    databaseRequested = false;
    if (input) input.value = '';
    view = isProduct && sites.length ? 'list' : 'empty';
  }

  const totalBytes = $derived(files.reduce((sum, file) => sum + file.size, 0));
  const hasIndex = $derived(prepared.some((asset) => asset.path === 'index.html'));
  const hasWorker = $derived(prepared.some((asset) => asset.path === '_worker.js'));
  const readers = $derived(parseReaders(readersText));
  const accessReady = $derived(
    visibility === 'company' ||
      (visibility === 'restricted' && readers.length > 0) ||
      (visibility === 'public' && publicConfirmed),
  );

  function parseReaders(value: string): ReaderRule[] {
    const seen = new Set<string>();
    const rules: ReaderRule[] = [];
    for (const raw of value.split(/[\n,]/)) {
      const token = raw.trim().toLowerCase();
      if (!token) continue;
      const rule: ReaderRule = token.startsWith('group:')
        ? { type: 'group', value: token.slice(6).trim() }
        : token.includes('@') && !token.startsWith('@')
          ? { type: 'email', value: token }
          : { type: 'domain', value: token.replace(/^@/, '') };
      const key = `${rule.type}:${rule.value}`;
      if (rule.value && !seen.has(key)) {
        seen.add(key);
        rules.push(rule);
      }
    }
    return rules;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function publish() {
    if (!isProduct || !siteName || !prepared.length || !hasIndex || !accessReady || publishing)
      return;
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
          access: { visibility, readers: visibility === 'restricted' ? readers : [] },
        }),
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
      if (databaseRequested && hasWorker) {
        const database = await fetch(`/api/sites/${encodeURIComponent(siteName)}/database`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        });
        if (!database.ok) throw new Error((await database.json()).error || 'Database setup failed');
      }
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
        <div class="home-swash"><PaintSwash /></div>
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
        <article><span>02</span><h3>Choose visibility</h3><p>Company by default; restrict to readers and groups, or explicitly publish to everyone.</p></article>
        <article><span>03</span><h3>Run backend code</h3><p>A root <code>_worker.js</code> handles <code>/api/*</code> in a network-isolated Dynamic Worker.</p></article>
        <article><span>04</span><h3>Bind secrets</h3><p>Encrypted write-only capabilities inject credentials only for allowlisted HTTPS hosts.</p></article>
        <article><span>05</span><h3>Store data</h3><p>Enable an isolated SQLite Durable Object that no other site can address.</p></article>
        <article><span>06</span><h3>Schedule jobs</h3><p>Bounded UTC jobs include quotas, retries, pause/disable behavior, and audit receipts.</p></article>
        <article><span>07</span><h3>Publish atomically</h3><p>Every digest is verified before a deployment becomes visible. Partial updates never leak.</p></article>
        <article><span>08</span><h3>Stay in control</h3><p>The Worker, Durable Objects, R2, DNS, and Access app remain in your account.</p></article>
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
            <h1>Publish a site.</h1>
            <p>Choose a static folder. Up gives it a company-private URL.</p>
            <button class="primary choose" onclick={chooseFolder}>Choose a folder <span aria-hidden="true">↗</span></button>
            <small><i aria-hidden="true"></i> Protected by Cloudflare Access</small>
          </div>
          <div class="brand-stroke" aria-hidden="true"><PaintSwash /></div>
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
                <div><span>{site.owner}</span><small>{site.access?.visibility || 'company'} · {site.activeDeploymentId ? 'Published' : 'Pending'}</small><button class="manage-link" onclick={() => openManagement(site)}>Manage</button></div>
              </article>
            {/each}
          </div>
        </div>
      {:else if view === 'manage' && managedSite}
        <div class="manage-view">
          <button class="back" onclick={() => (view = 'list')}>← Sites</button>
          <p class="state-label">Site settings</p>
          <h1>{managedSite.name}</h1>
          <a class="managed-url" href={`https://${managedSite.name}.${siteDomain}`} target="_blank" rel="noopener noreferrer">{managedSite.name}.{siteDomain} ↗</a>
          {#if manageStatus}<p class="manage-status" role="status">{manageStatus}</p>{/if}

          <section class="manage-section">
            <div class="manage-heading"><div><span>01</span><h2>Visibility</h2></div><p>Company is the default. Public is always explicit.</p></div>
            <div class="manage-choice">
              <label><input type="radio" bind:group={managedVisibility} value="company" /> Company</label>
              <label><input type="radio" bind:group={managedVisibility} value="restricted" /> Restricted</label>
              <label><input type="radio" bind:group={managedVisibility} value="public" /> Public</label>
            </div>
            {#if managedVisibility === 'restricted'}<textarea class="manage-textarea" bind:value={managedReaders} rows="3" placeholder="person@example.com, @partner.example, group:engineering"></textarea>{/if}
            <button class="secondary small" onclick={saveManagedAccess}>Save visibility</button>
          </section>

          <section class="manage-section">
            <div class="manage-heading"><div><span>02</span><h2>Server runtime</h2></div><p>{managedSite.runtimeEnabled ? '_worker.js active' : 'Static only'}</p></div>
            {#if managedSite.runtimeEnabled}
              <div class="capability-row"><div><strong>SQLite database</strong><small>{managedSite.databaseEnabled ? 'Enabled · disabling permanently deletes its data.' : 'Disabled'}</small></div><button class="secondary small danger" onclick={toggleManagedDatabase}>{managedSite.databaseEnabled ? 'Delete database' : 'Enable database'}</button></div>
            {:else}<p class="manage-empty">Publish a root <code>_worker.js</code> to unlock backend capabilities.</p>{/if}
          </section>

          <section class="manage-section">
            <div class="manage-heading"><div><span>03</span><h2>Secret capabilities</h2></div><p>Write-only bearer credentials with exact host allowlists.</p></div>
            {#if managedSite.runtimeEnabled}
              <div class="manage-form three"><input bind:value={secretName} placeholder="API_TOKEN" aria-label="Secret name" /><input bind:value={secretHosts} placeholder="api.example.com" aria-label="Allowed hosts" /><input bind:value={secretValue} type="password" placeholder="Secret value" aria-label="Secret value" /><button class="primary small" onclick={saveSecret} disabled={!secretName || !secretHosts || !secretValue}>Save secret</button></div>
              <div class="capability-list">{#each managedSecrets as secret}<article><div><strong>{secret.name}</strong><small>{secret.allowedHosts.join(', ')}</small></div><button class="text-button" onclick={() => deleteSecret(secret.name)}>Delete</button></article>{:else}<p class="manage-empty">No secret capabilities.</p>{/each}</div>
            {:else}<p class="manage-empty">Secrets require an active server runtime.</p>{/if}
          </section>

          <section class="manage-section">
            <div class="manage-heading"><div><span>04</span><h2>Schedules</h2></div><p>UTC · 24 runs/day · 3 retries by default.</p></div>
            {#if managedSite.runtimeEnabled}
              <div class="manage-form"><input bind:value={schedulePath} placeholder="/api/jobs/run" aria-label="Schedule path" /><input bind:value={scheduleCron} placeholder="0 * * * *" aria-label="Cron expression" /><button class="primary small" onclick={addSchedule}>Add schedule</button></div>
              <div class="capability-list">{#each managedSchedules as schedule}<article><div><strong>{schedule.path}</strong><small>{schedule.cron} · {schedule.status} · next {new Date(schedule.nextRunAt).toLocaleString()}</small></div><div class="inline-actions">{#if schedule.status === 'enabled'}<button class="text-button" onclick={() => updateSchedule(schedule, 'paused')}>Pause</button>{:else}<button class="text-button" onclick={() => updateSchedule(schedule, 'enabled')}>Enable</button>{/if}<button class="text-button" onclick={() => updateSchedule(schedule, 'disabled')}>Disable</button><button class="text-button" onclick={() => deleteSchedule(schedule.id)}>Delete</button></div></article>{:else}<p class="manage-empty">No schedules.</p>{/each}</div>
            {:else}<p class="manage-empty">Schedules require an active server runtime.</p>{/if}
          </section>
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
          <details class="publish-options">
            <summary>Visibility and server capabilities <span aria-hidden="true">＋</span></summary>
            <fieldset>
              <legend>Who can open this site?</legend>
              <label><input type="radio" bind:group={visibility} value="company" /> <span><b>Company</b><small>Anyone authenticated by your organization. Default.</small></span></label>
              <label><input type="radio" bind:group={visibility} value="restricted" /> <span><b>Restricted</b><small>Only listed employees, domains, or IdP groups.</small></span></label>
              <label><input type="radio" bind:group={visibility} value="public" /> <span><b>Public</b><small>Anyone on the internet. No Access identity required.</small></span></label>
            </fieldset>
            {#if visibility === 'restricted'}
              <label class="reader-input"><span>Readers</span><textarea bind:value={readersText} rows="3" placeholder="person@example.com, @partner.example, group:engineering"></textarea><small>Separate rules with commas or new lines.</small></label>
            {:else if visibility === 'public'}
              <label class="public-confirm"><input type="checkbox" bind:checked={publicConfirmed} /> <span>I understand every uploaded byte and backend response can be reached anonymously.</span></label>
            {/if}
            <div class="runtime-option">
              <div><b>Server runtime</b><small>{hasWorker ? '_worker.js detected — /api/* will run in an isolated Dynamic Worker.' : 'Add _worker.js to enable an isolated backend.'}</small></div>
              {#if hasWorker}<label><input type="checkbox" bind:checked={databaseRequested} /> Isolated SQLite database</label>{/if}
            </div>
          </details>
          <p class="privacy"><i></i> {visibility === 'public' ? 'Explicitly public' : visibility === 'restricted' ? `${readers.length} reader rule${readers.length === 1 ? '' : 's'}` : 'Private to your organization'}</p>
          <div class="footer-actions">
            <button class="secondary" onclick={reset}>Cancel</button>
            {#if isProduct}
              <button class="primary" onclick={publish} disabled={!hasIndex || !siteName || !accessReady}>{status === 'Ready to publish' ? 'Publish site' : status}</button>
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
        <h1>Operate Up</h1><p class="summary">Keep each capability explicit and the trust boundary intact.</p><h2>Update a site</h2><p>Publish the same site name. Up activates the replacement only after every asset passes verification.</p><h2>Change visibility</h2><p>Open <strong>Manage</strong> beside a site. Choose company, restricted readers, or public. Public is never inferred and always requires explicit confirmation during first publish.</p><h2>Add a backend</h2><pre><code>Build static files into ./dist.
Add ./dist/_worker.js for /api/* routes.
Keep secrets out of browser code.
Publish the folder through Up.</code></pre><p>After publishing, Manage can enable SQLite, write secret capabilities, and create bounded schedules.</p><h2>Respond to exposure</h2><p>Set the site to company/restricted or disable its schedules first. Never expose the control Worker, private R2 bucket, or runtime keys.</p>
      {:else if section === 'reference'}
        <h1>Reference</h1><p class="summary">Exact contracts for version 0.0.1.</p><table><tbody><tr><th><code>GET /app</code></th><td>Authenticated publisher</td></tr><tr><th><code>GET /api/sites</code></th><td>List readable sites</td></tr><tr><th><code>POST /api/sites/:name/deployments</code></th><td>Create deployment + visibility</td></tr><tr><th><code>PATCH /api/sites/:name/access</code></th><td>Company, restricted, or public</td></tr><tr><th><code>PATCH /api/sites/:name/database</code></th><td>Enable/delete isolated SQLite</td></tr><tr><th><code>GET|PUT|DELETE /api/sites/:name/secrets</code></th><td>Write-only secret capabilities</td></tr><tr><th><code>GET|POST|PATCH|DELETE /api/sites/:name/schedules</code></th><td>Bounded scheduled jobs</td></tr><tr><th><code>GET /api/sites/:name/audit</code></th><td>Capability and run receipts</td></tr><tr><th><code>PUT /api/deployments/:id/assets</code></th><td>Verify and store asset</td></tr><tr><th><code>POST /api/deployments/:id/activate</code></th><td>Atomic activation</td></tr></tbody></table><h2>Limits</h2><ul><li>500 files; 10 MiB per file; 50 MiB total</li><li><code>index.html</code> required</li><li><code>_worker.js</code> maximum 1 MiB</li><li>Dynamic request: 50 ms CPU, 5 subrequests, network blocked by default</li><li>100 reader rules; 20 secret hosts; 1,000 database rows per response</li><li>1,440 scheduled attempts/day maximum; 10 retries maximum</li></ul>
      {:else if section === 'explanation'}
        <h1>The boundary is the product.</h1><p class="summary">One installation gives a company a private place for small web software—with deliberate escape hatches, never accidental ones.</p><h2>Private is the default</h2><p>Company visibility requires identity. Restricted visibility adds application ACLs. Public visibility is explicit registry state and does not inherit private capabilities accidentally.</p><h2>Content stays separate</h2><p>Browser code runs on sibling hostnames. Optional backend code runs in a separate Dynamic Worker isolate with no registry, deployment authority, R2 bucket, encryption keys, or global network.</p><h2>Capabilities are narrow</h2><p>Database and secret bindings are scoped to one site. Secret values are never returned. Scheduled jobs are leased, quota-bound, retried, and audited by trusted code.</p><h2>Deployment is atomic</h2><p>Files remain pending in private R2 until every manifest digest is verified. Visitors never see a partial update.</p>
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
  :global(html) { background: var(--white); scroll-behavior: smooth; }
  :global(body) { min-width: 320px; margin: 0; background: linear-gradient(180deg, #fff 0%, #fcfdfe 64%, var(--paper) 100%); color: var(--ink); font-family: var(--sans); font-synthesis: none; }
  :global(button), :global(input), :global(textarea), :global(select) { font: inherit; }
  :global(a) { color: inherit; }
  :global(code), :global(pre) { font-family: var(--mono); }
  :global(::selection) { background: #f6821f38; }
  :global(a:focus-visible), :global(button:focus-visible), :global(input:focus-visible), :global(textarea:focus-visible), :global(summary:focus-visible) { outline: 3px solid #71b8d8aa; outline-offset: 3px; }

  header, main, footer { width: min(100%, var(--page)); margin-inline: auto; padding-inline: var(--gutter); }
  header { display: flex; height: 72px; align-items: center; border-bottom: 1px solid var(--line); }
  .wordmark { display: inline-flex; align-items: center; gap: 9px; font-size: 1.05rem; font-weight: 760; letter-spacing: -.045em; text-decoration: none; }
  .wordmark > i { width: 11px; height: 11px; border-radius: 50%; background: var(--orange); box-shadow: 7px -5px 0 -3px var(--cyan); }
  header nav { display: flex; align-items: center; gap: clamp(16px, 3vw, 30px); margin-left: auto; color: var(--muted); font-size: .76rem; }
  header nav a { text-decoration: none; transition: color .15s ease; }
  header nav a:hover { color: var(--ink); }
  .identity { display: inline-flex; max-width: min(310px, 60vw); min-height: 36px; align-items: center; gap: 8px; padding: 0 13px; overflow: hidden; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); font: 500 .66rem var(--mono); text-overflow: ellipsis; white-space: nowrap; }
  .identity > i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--green); }
  main { min-height: calc(100vh - 140px); padding-top: clamp(40px, 6vw, 72px); padding-bottom: clamp(72px, 9vw, 112px); }
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
  .home-shell { width: min(100%, 1120px); margin-inline: auto; border-top: 1px solid var(--line); }
  .home-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .82fr); align-items: center; gap: clamp(36px, 5vw, 72px); padding: clamp(54px, 7vw, 88px) var(--gutter) clamp(60px, 7vw, 92px); border-bottom: 1px solid var(--line); }
  .home-hero-copy { min-width: 0; }
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
  .home-swash { height:clamp(300px,38vw,430px); margin-right:-6%; transform:rotate(-2deg); }
  .home-intro, .system-model, .read-next { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 30px; padding: var(--section) var(--gutter); border-bottom: 1px solid var(--line); }
  .home-intro h2, .system-model h2, .docs-map h2, .read-next h2 { margin: 0; font-size: clamp(1.65rem, 3vw, 2.45rem); font-weight: 640; line-height: 1.08; letter-spacing: -.028em; }
  .home-intro > div > p { max-width: 680px; margin: 30px 0 0; color: var(--muted); font-size: 1rem; line-height: 1.74; }
  .feature-grid { display: grid; grid-template-columns: repeat(4, 1fr); overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); }
  .feature-grid article { min-height: 228px; padding: 26px; border-right: 1px solid var(--line); }
  .feature-grid article:nth-child(4n) { border-right: 0; }
  .feature-grid article:nth-child(-n+4) { border-bottom: 1px solid var(--line); }
  .feature-grid article > span { color: var(--orange); font: 500 .62rem var(--mono); }
  .feature-grid h3 { margin: 26px 0 10px; font-size: .98rem; letter-spacing: -.018em; }
  .feature-grid p { margin: 0; color: var(--muted); font-size: .75rem; line-height: 1.62; }
  .feature-grid code { font-size: .7rem; }
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
  .empty-state h1, .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1, .manage-view h1 { margin: 0; font-weight: 640; line-height: 1.04; letter-spacing: -.03em; }
  .empty-state h1 { font-size: clamp(2.6rem, 5vw, 3.7rem); line-height: 1.0; }
  .empty-copy > p:not(.state-label) { max-width: 390px; margin: 24px 0 32px; color: var(--muted); font-size: .98rem; line-height: 1.64; }
  .empty-copy small { display: flex; align-items: center; gap: 8px; margin-top: 18px; color: var(--quiet); font-size: .69rem; }
  .empty-copy small > i, .privacy i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--green); }
  .choose { min-width: 184px; justify-content: space-between; gap: 32px; }
  .brand-stroke { position: relative; align-self: stretch; min-height: 480px; margin-right: -24px; pointer-events: none; }
  .brand-stroke :global(svg) { position:absolute; inset:2% -4% 0 -10%; width:115%; height:100%; transform:rotate(-3deg); }
  .selected-view, .publishing-view, .success-view, .list-view, .manage-view { width: min(100%, 820px); margin-inline: auto; }
  .selected-view, .publishing-view, .success-view { padding-left: 28px; border-left: 2px solid var(--orange); }
  .back { min-height: 36px; margin: 0 0 44px; padding: 0; border: 0; background: none; color: var(--muted); font: 500 .68rem var(--mono); cursor: pointer; }
  .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1, .manage-view h1 { font-size: clamp(1.85rem, 3.4vw, 2.6rem); }
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
  .publish-options { margin-top: 22px; border-block: 1px solid var(--line); background: #fbfbf8; }
  .publish-options summary { display: flex; min-height: 46px; align-items: center; justify-content: space-between; padding: 0 13px; cursor: pointer; font-size: .72rem; font-weight: 650; list-style: none; }
  .publish-options summary::-webkit-details-marker { display: none; }
  .publish-options[open] summary span { transform: rotate(45deg); }
  .publish-options fieldset { display: grid; margin: 0; padding: 0 13px 13px; border: 0; }
  .publish-options legend { padding: 14px 0 8px; color: var(--quiet); font: 500 .61rem var(--mono); text-transform: uppercase; }
  .publish-options fieldset label { display: grid; grid-template-columns: 22px 1fr; padding: 10px 0; border-top: 1px solid var(--line); cursor: pointer; }
  .publish-options input, .manage-choice input { accent-color: var(--orange); }
  .publish-options fieldset b, .runtime-option b { display: block; font-size: .72rem; }
  .publish-options fieldset small, .reader-input small, .runtime-option small { display: block; margin-top: 3px; color: var(--quiet); font-size: .64rem; line-height: 1.45; }
  .reader-input { display: grid; gap: 7px; padding: 0 13px 14px; font-size: .68rem; }
  .reader-input textarea, .manage-textarea { width: 100%; resize: vertical; padding: 10px; border: 1px solid var(--line-strong); border-radius: 4px; background: #fff; font: 400 .71rem/1.5 var(--mono); }
  .public-confirm { display: grid; grid-template-columns: 22px 1fr; margin: 0 13px 14px; padding: 11px; border: 1px solid #efb49b; background: #fff8f5; color: #71351f; font-size: .68rem; line-height: 1.45; }
  .runtime-option { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 13px; border-top: 1px solid var(--line); }
  .runtime-option > div { max-width: 480px; }
  .runtime-option > label { display: flex; align-items: center; gap: 7px; font-size: .67rem; }
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
  .published-url, .managed-url { display: block; margin: 24px 0 28px; color: var(--blue); font: 500 .82rem var(--mono); text-decoration: none; word-break: break-all; }
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
  .manage-link { justify-self: end; padding: 0; border: 0; background: none; color: var(--blue); font-size: .67rem; cursor: pointer; }

  /* Management */
  .manage-status { margin: 0 0 18px; padding: 10px 12px; border-left: 2px solid var(--orange); background: #fff8f4; color: #60351e; font-size: .71rem; }
  .manage-section { padding: 28px 0; border-top: 1px solid var(--line); }
  .manage-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; margin-bottom: 20px; }
  .manage-heading > div { display: flex; align-items: baseline; gap: 13px; }
  .manage-heading span { color: var(--orange); font: 500 .59rem var(--mono); }
  .manage-heading h2 { margin: 0; font-size: .98rem; }
  .manage-heading > p { max-width: 330px; margin: 0; color: var(--quiet); font-size: .67rem; line-height: 1.5; text-align: right; }
  .manage-choice { display: flex; gap: 18px; margin-bottom: 14px; font-size: .71rem; }
  .manage-choice label { display: flex; align-items: center; gap: 6px; }
  .manage-textarea { margin-bottom: 11px; }
  .capability-row, .capability-list article { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 13px 0; border-top: 1px solid var(--line); }
  .capability-row small, .capability-list small { display: block; margin-top: 4px; color: var(--quiet); font-size: .64rem; }
  .danger { color: var(--red); }
  .manage-form { display: grid; grid-template-columns: minmax(0, 1fr) 150px auto; gap: 8px; margin-bottom: 16px; }
  .manage-form.three { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
  .manage-form input { min-width: 0; height: 38px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 4px; font: 400 .67rem var(--mono); }
  .capability-list { border-bottom: 1px solid var(--line); }
  .inline-actions { display: flex; gap: 12px; }
  .manage-empty { margin: 0; color: var(--quiet); font-size: .71rem; }

  @media (max-width: 900px) {
    .home-hero { grid-template-columns: 1fr; gap: 36px; }
    .home-swash { order:-1; height:300px; margin:0 8% -20px; }
    .home-intro, .system-model, .read-next { grid-template-columns: minmax(0, 1fr); gap: 28px; }
    .system-model > div { min-width: 0; }
    .feature-grid { grid-template-columns: repeat(2, 1fr); }
    .feature-grid article:nth-child(2n) { border-right: 0; }
    .feature-grid article:nth-child(n) { border-bottom: 1px solid var(--line); }
    .feature-grid article:nth-last-child(-n+2) { border-bottom: 0; }
    .docs-map-heading { grid-template-columns: 1fr; gap: 26px; }
    .docs-shell { grid-template-columns: 1fr; gap: 40px; }
    .docs-nav { position: static; min-height: 0; padding: 0; border-right: 0; border-bottom: 1px solid var(--line); }
    .docs-nav nav { grid-template-columns: 1fr 1fr; }
    .docs-nav nav a:nth-child(odd) { border-right: 1px solid var(--line); }
    .docs-nav > div { display: none; }
    .empty-state { grid-template-columns: 1fr; }
    .empty-copy { padding: 58px 28px 0; }
    .brand-stroke { min-height: 310px; margin: -6px -30px -8px 20%; }
    .brand-stroke :global(svg) { inset: -8% -8% 0 -15%; width: 120%; }
    .manage-form, .manage-form.three { grid-template-columns: 1fr 1fr; }
  }

  @media (max-width: 600px) {
    header, main, footer { padding-inline: 18px; }
    header nav a:not(:last-child) { display: none; }
    main { padding-top: 34px; padding-bottom: 64px; }
    .home-hero { padding: 44px 14px 56px; }
    .home-hero h1 { font-size: clamp(2.15rem, 10vw, 2.9rem); }
    .home-actions { align-items: flex-start; flex-direction: column; gap: 12px; }
    .home-swash { height:240px; margin:0 -8% -12px 4%; }
    .home-intro, .system-model, .read-next, .docs-map { padding: 56px 14px; }
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
    .brand-stroke { min-height: 260px; margin: 0 -34px 0 10%; }
    .selected-view, .publishing-view, .success-view { padding-left: 18px; }
    .selected-view h1, .publishing-view h1, .success-view h1, .view-heading h1, .manage-view h1 { font-size: 2.7rem; }
    .file-summary { grid-template-columns: 1fr; }
    .file-summary div, .file-summary div:first-child { min-height: 56px; flex-direction: row; align-items: center; padding: 12px 0; border-right: 0; border-bottom: 1px solid var(--line); }
    .file-summary div:last-child { border-bottom: 0; }
    .address > div { display: grid; }
    .address em { padding: 0 14px 11px; }
    .runtime-option, .manage-heading, .capability-row, .capability-list article { align-items: flex-start; flex-direction: column; }
    .footer-actions { display: grid; grid-template-columns: 1fr 1.35fr; }
    .footer-actions > * { width: 100%; }
    .site-list article { grid-template-columns: 1fr; }
    .site-list article > div:last-child { justify-items: start; text-align: left; }
    .manage-link { justify-self: start; }
    .manage-heading > p { text-align: left; }
    .manage-choice { align-items: flex-start; flex-direction: column; }
    .manage-form, .manage-form.three { grid-template-columns: 1fr; }
    .manage-form button { width: 100%; }
    .inline-actions { flex-wrap: wrap; }
    footer nav a:first-child { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*) { scroll-behavior: auto !important; transition: none !important; }
    .brand-stroke :global(svg) { transform: none; }
  }
</style>
