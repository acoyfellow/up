<svg viewBox="0 0 760 390" role="presentation" aria-hidden="true">
  <defs>
    <filter id="up-paint" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.09" numOctaves="2" seed="12" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" />
    </filter>
  </defs>
  <g class="paint" fill="none" stroke-linecap="round" filter="url(#up-paint)">
    <path class="stroke navy" d="M74 311 C184 268 237 102 410 98 C523 96 594 175 697 64" />
    <path class="stroke cobalt" d="M52 333 C201 302 249 151 397 126 C515 106 591 183 702 94" />
    <path class="stroke coral" d="M126 350 C269 327 323 219 445 180 C566 142 642 180 731 122" />
    <path class="stroke orange" d="M154 363 C304 329 366 240 471 207 C585 171 661 193 742 147" />
    <path class="stroke cyan" d="M95 325 C225 277 289 177 407 149 C498 128 570 160 639 124" />
  </g>
  <g class="bristles" fill="none" stroke-linecap="round">
    <path class="bristle blue" d="M64 341 C210 290 269 157 411 127 C520 104 601 170 716 87" />
    <path class="bristle warm" d="M145 373 C296 337 357 250 478 213 C589 180 666 197 747 151" />
    <path class="bristle white" d="M126 335 C248 293 318 199 430 171" />
  </g>
</svg>

<style>
  svg { display:block; width:100%; height:100%; overflow:visible; }
  .stroke { stroke-width:72; }
  .navy { stroke:#0b1118; }
  .cobalt { stroke:#2678a4; stroke-width:58; }
  .coral { stroke:#ed2347; stroke-width:66; }
  .orange { stroke:#f6821f; stroke-width:44; }
  .cyan { stroke:#71b8d8; stroke-width:24; }
  .bristles { opacity:.52; }
  .bristle { stroke-width:5; }
  .blue { stroke:#72d9f2; }
  .warm { stroke:#ffb068; }
  .white { stroke:#fff; stroke-width:7; }
</style>
