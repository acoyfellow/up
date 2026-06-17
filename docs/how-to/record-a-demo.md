# Record an authenticated publish demo

The video workflow uses a dedicated Chrome profile. It never imports cookies from a normal browser and never records credentials.

## 1. Prepare the real installation

The control plane must be deployed at `https://app.up.ax.cloudflare.dev`, protected by Cloudflare Access, and the invited test user must have permission to publish.

## 2. Authenticate the isolated profile

```sh
bun run video:login
```

Complete Cloudflare login in the opened window. This ceremony is intentionally outside the recording.

## 3. Record the baseline flow

```sh
bun run video:record
```

The script records:

1. authenticated Up shell;
2. upload of `examples/baseline-site`;
3. deterministic site name `baseline-video`;
4. real manifest upload and activation;
5. published receipt.

Output:

```text
artifacts/video/up-publish.webm
```

Override values when needed:

```sh
UP_VIDEO_SITE=baseline-take-2 \
UP_VIDEO_OUTPUT=artifacts/video/take-2.webm \
bun run video:record
```

## 4. Convert to MP4

```sh
ffmpeg -i artifacts/video/up-publish.webm \
  -c:v libx264 -pix_fmt yuv420p \
  artifacts/video/up-publish.mp4
```

The output directory is gitignored. Review the video locally before sharing it.
