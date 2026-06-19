# Record the capability demo

The checked-in demo is assembled from real screenshots captured through cmux while it drives the authenticated Up site. No browser credentials are imported, and no login screen is recorded.

```sh
bun run video:record
```

The script:

1. opens `lunch-vote.up.ax.cloudflare.dev` in a cmux browser surface;
2. records an authenticated vote;
3. stores a menu through `up.files`;
4. requests a summary through `up.ai`;
5. verifies the browser reported no errors;
6. encodes the timed frames with ffmpeg.

Output:

```text
demo/up-0.0.1.mp4
```

Override the site or output when needed:

```sh
UP_VIDEO_SITE_URL=https://another-site.up.example.com/ \
UP_VIDEO_OUTPUT=demo/another.mp4 \
bun run video:record
```

cmux’s WKWebView does not currently expose native screencast capture. The script therefore samples real browser frames rather than simulating the UI or using a second browser automation profile.
