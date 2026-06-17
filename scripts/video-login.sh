#!/usr/bin/env bash
set -euo pipefail

origin="${UP_CONTROL_ORIGIN:-https://up.ax.cloudflare.dev}"
profile="${UP_VIDEO_PROFILE:-$HOME/.up-video-profile}"
session="${UP_VIDEO_SESSION:-up-video}"

printf 'Opening isolated Up recording profile.\n'
printf 'Profile: %s\n' "$profile"
printf 'URL: %s/app\n' "$origin"

AGENT_BROWSER_PROFILE="$profile" \
AGENT_BROWSER_HEADED=1 \
  agent-browser --session "$session" open "$origin/app"

printf '\nComplete Cloudflare login in that window. Keep it open when finished.\n'
printf 'Then run: bun run video:record\n'
