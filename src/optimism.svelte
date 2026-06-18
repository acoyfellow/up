<script lang="ts">
import { optimismStudies } from './optimism.generated';

const studies = optimismStudies.jobs.filter((study) => study.status === 'ok');
let active = $state(0);
let stage = $state<HTMLElement>();
// biome-ignore lint/correctness/noUnusedVariables: referenced by the Svelte template
const current = $derived(studies[active]);

// biome-ignore lint/correctness/noUnusedVariables: referenced by the Svelte template
function move(direction: number) {
  active = (active + direction + studies.length) % studies.length;
  stage?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
</script>

<div class="optimism-shell">
  <section class="optimism-intro" aria-labelledby="optimism-title">
    <p class="optimism-kicker"><i aria-hidden="true"></i>Up image studies / 01</p>
    <h1 id="optimism-title">A private boundary<br />with somewhere to go.</h1>
    <p>Ten readings of Up and the systems around it. The scale stays overwhelming, but the destination is open, inhabited, and worth approaching.</p>
    <div class="optimism-rule"><span>Image rule</span><strong>Every boundary reveals a destination.</strong></div>
  </section>

  <section class="optimism-stage" bind:this={stage} aria-live="polite">
    <div class="stage-heading">
      <div><span>{String(active + 1).padStart(2, '0')} / {String(studies.length).padStart(2, '0')}</span><h2>{current.title}</h2><p>{current.mechanism}</p></div>
      <div class="stage-controls"><button onclick={() => move(-1)} aria-label="Previous image study">←</button><button onclick={() => move(1)} aria-label="Next image study">→</button></div>
    </div>
    <figure>
      <img src={current.file} alt={current.title} width={current.width} height={current.height} />
      <figcaption><i aria-hidden="true"></i><span>{current.shift}</span><em>{current.model} · seed {current.seed}</em></figcaption>
    </figure>
    <details>
      <summary>Prompt and model receipt</summary>
      <div><span>Prompt</span><p>{current.prompt}</p></div>
      <div><span>Model</span><p>{current.resolvedModel} · seed {current.seed} · {current.width} × {current.height} · {Math.round(current.bytes / 1024)} KB</p></div>
    </details>
  </section>

  <nav class="study-strip" aria-label="Optimism image studies">
    {#each studies as study, i}
      <button class:active={i === active} onclick={() => (active = i)} aria-label={`Show ${study.title}`}>
        <img src={study.file} alt="" loading="lazy" />
        <span><b>{String(i + 1).padStart(2, '0')}</b>{study.title}</span>
      </button>
    {/each}
  </nav>

  <section class="optimism-notes">
    <div><p>What changed</p><h2>Keep the scale.<br />Change the invitation.</h2></div>
    <ol>
      <li><b>Open</b><span>Gates reveal cities, workshops, gardens, and people.</span></li>
      <li><b>Inhabit</b><span>Someone has already cared for the destination.</span></li>
      <li><b>Participate</b><span>The operator approaches, tends, builds, or shares.</span></li>
      <li><b>Return</b><span>The story ends with evidence brought back for others.</span></li>
    </ol>
  </section>

  <div class="optimism-links"><a href="/">← Up</a><a href="/img/optimism/manifest.json">Generation manifest ↗</a></div>
</div>

<style>
  .optimism-shell { width:min(100%,1120px); margin-inline:auto; color:var(--ink); }
  .optimism-intro { max-width:760px; padding:clamp(48px,7vw,84px) var(--gutter) 36px; }
  .optimism-kicker { display:flex; align-items:center; gap:9px; margin:0; color:var(--quiet); font:500 .63rem var(--mono); letter-spacing:.08em; text-transform:uppercase; }
  .optimism-kicker i { width:6px; height:6px; border-radius:50%; background:var(--orange); }
  .optimism-intro h1 { margin:22px 0 18px; font-size:clamp(2.4rem,5vw,4rem); font-weight:640; line-height:1.02; letter-spacing:-.04em; }
  .optimism-intro > p:not(.optimism-kicker) { max-width:650px; margin:0; color:var(--muted); font-size:1rem; line-height:1.7; }
  .optimism-rule { display:flex; width:max-content; max-width:100%; align-items:baseline; gap:13px; margin-top:26px; padding:10px 13px; border:1px solid var(--line-strong); border-radius:999px; background:#fff; }
  .optimism-rule span { color:var(--orange); font:500 .58rem var(--mono); letter-spacing:.06em; text-transform:uppercase; }
  .optimism-rule strong { font-size:.74rem; }
  .optimism-stage { padding:clamp(44px,6vw,72px) var(--gutter) 0; scroll-margin-top:24px; }
  .stage-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding-bottom:16px; border-bottom:1px solid var(--line-strong); }
  .stage-heading span { color:var(--orange); font:500 .59rem var(--mono); }
  .stage-heading h2 { margin:7px 0 0; font-size:clamp(1.6rem,3vw,2.35rem); line-height:1.08; letter-spacing:-.03em; }
  .stage-heading p { margin:6px 0 0; color:var(--muted); font-size:.72rem; }
  .stage-controls { display:flex; gap:7px; }
  .stage-controls button { width:42px; height:42px; border:1px solid var(--line-strong); border-radius:50%; background:#fff; color:var(--ink); cursor:pointer; }
  .stage-controls button:hover { border-color:var(--orange); color:var(--orange); }
  figure { position:relative; margin:18px 0 0; overflow:hidden; border:1px solid var(--line-strong); border-radius:var(--radius-lg); background:var(--navy); box-shadow:var(--shadow-lg); }
  figure img { display:block; width:100%; aspect-ratio:3/2; object-fit:cover; }
  figcaption { position:absolute; right:0; bottom:0; left:0; display:flex; align-items:center; gap:9px; padding:48px 16px 14px; background:linear-gradient(transparent,rgba(5,10,16,.86)); color:#fff; font-size:.7rem; }
  figcaption i { width:6px; height:6px; flex:0 0 auto; border-radius:50%; background:var(--orange); }
  figcaption em { margin-left:auto; color:#b6c7d2; font:500 .56rem var(--mono); font-style:normal; text-transform:uppercase; }
  details { margin-top:10px; border:1px solid var(--line); border-radius:var(--radius-md); background:#fff; }
  details summary { padding:12px 14px; color:var(--muted); font:600 .62rem var(--mono); cursor:pointer; }
  details > div { display:grid; grid-template-columns:72px 1fr; gap:16px; padding:12px 14px; border-top:1px solid var(--line); }
  details span { color:var(--orange); font:500 .56rem var(--mono); text-transform:uppercase; }
  details p { margin:0; color:var(--muted); font-size:.7rem; line-height:1.55; }
  .study-strip { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; padding:14px var(--gutter) 0; }
  .study-strip button { min-width:0; padding:0; overflow:hidden; border:1px solid var(--line); border-radius:var(--radius-md); background:#fff; color:var(--ink); text-align:left; cursor:pointer; }
  .study-strip button.active { border-color:var(--orange); box-shadow:0 0 0 2px #f6821f1c; }
  .study-strip img { display:block; width:100%; aspect-ratio:3/2; object-fit:cover; }
  .study-strip span { display:flex; gap:6px; padding:8px; overflow:hidden; font-size:.61rem; text-overflow:ellipsis; white-space:nowrap; }
  .study-strip b { color:var(--orange); font:500 .56rem var(--mono); }
  .optimism-notes { display:grid; grid-template-columns:.8fr 1.2fr; gap:48px; margin:clamp(64px,9vw,100px) var(--gutter) 0; padding-top:24px; border-top:1px solid var(--line-strong); }
  .optimism-notes > div > p { margin:0 0 10px; color:var(--orange); font:500 .6rem var(--mono); letter-spacing:.08em; text-transform:uppercase; }
  .optimism-notes h2 { margin:0; font-size:clamp(1.5rem,3vw,2.2rem); line-height:1.08; letter-spacing:-.03em; }
  .optimism-notes ol { margin:0; padding:0; list-style:none; border-top:1px solid var(--line); }
  .optimism-notes li { display:grid; grid-template-columns:80px 1fr; gap:16px; padding:13px 0; border-bottom:1px solid var(--line); }
  .optimism-notes b { font-size:.75rem; }
  .optimism-notes span { color:var(--muted); font-size:.72rem; line-height:1.5; }
  .optimism-links { display:flex; justify-content:space-between; margin:60px var(--gutter) 0; padding-top:18px; border-top:1px solid var(--line); }
  .optimism-links a { color:var(--blue); font:500 .65rem var(--mono); text-decoration:none; }
  @media(max-width:700px) {
    .optimism-intro,.optimism-stage { padding-inline:14px; }
    .optimism-rule { align-items:flex-start; flex-direction:column; border-radius:var(--radius-md); }
    .stage-heading { align-items:flex-start; }
    figcaption { align-items:flex-start; flex-wrap:wrap; }
    figcaption em { width:100%; margin-left:15px; }
    details > div { grid-template-columns:1fr; gap:6px; }
    .study-strip { display:flex; overflow-x:auto; padding-inline:14px; scroll-snap-type:x mandatory; }
    .study-strip button { flex:0 0 72%; scroll-snap-align:start; }
    .optimism-notes { grid-template-columns:1fr; gap:28px; margin-inline:14px; }
    .optimism-links { margin-inline:14px; }
  }
</style>
