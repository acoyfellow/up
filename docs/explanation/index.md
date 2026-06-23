# Explanation: deploy before ownership

Up's default mode deliberately separates **deployment** from **ownership**.

Traditional cloud deployment begins with identity, an account, authorization, and credentials. That sequence blocks unattended coding agents at exactly the moment they need to inspect a real result.

Cloudflare Temporary Accounts invert it:

```text
write → deploy → fetch → revise → decide whether to claim
```

Wrangler requests and solves a proof-of-work challenge, creates a short-lived account, receives temporary credentials, and deploys to `workers.dev`. The human receives a sensitive dashboard claim URL. Claiming makes the account and its supported resources permanent; ignoring it lets Cloudflare delete the experiment.

## Public is explicit

The generated deployment has no Access boundary. Anyone with the URL can read it. A hard-to-guess hostname is not privacy, so Up labels the URL public and rejects the old company-private language in its default mode.

## Existing credentials are excluded

Anonymous behavior must be deterministic even on a developer machine already logged into Cloudflare. Up starts Wrangler in an isolated home and removes inherited Cloudflare token/account variables. It cannot silently deploy the experiment into the wrong permanent account.

## The claim URL is authority

The public URL grants reading. The claim URL grants ownership of the whole temporary account. It is therefore the more sensitive artifact and must stay out of git, telemetry, screenshots, CI output, and unrelated conversations.

## Why wrap Wrangler

The unauthenticated provisioning endpoint and proof-of-work representation are not a published third-party API contract. Up uses pinned Wrangler—the documented interface—rather than cloning implementation details that Cloudflare can change.

## Why company mode remains

The original Access-protected publishing plane explores a different question: what should a customer-owned private internal web look like? It remains available explicitly as `up private`, but it no longer defines Up's default product.
