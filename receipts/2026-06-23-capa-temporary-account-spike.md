# Up × Capa same-account spike — 2026-06-23

## Question

Can Up install a generated Capa API capability into the same unauthenticated Cloudflare Temporary Account as the user app, connect them with a JSRPC service binding, keep provider credentials out of the app and evidence, and transfer the graph through one account claim?

## Verdict

**Yes, the Cloudflare account/runtime composition works. The product installer does not exist yet.**

The spike proved:

```text
Temporary Account
├── Up caller Worker
├── generated Capa capability Worker
├── capability Worker secret
└── JSRPC service binding
```

The caller executed a real read-only API operation through the generated capability, received `{ result, evidence }`, redeployed, and executed the same binding again.

## Safe proof credential

No permanent provider credential was copied.

The spike generated a narrow Capa capability for one Cloudflare endpoint:

```text
GET https://api.cloudflare.com/client/v4/accounts
```

It used the Temporary Account's own short-lived API token as the capability Worker secret. The capability exposed only one generated read-only method. The token and account expire with the unclaimed spike.

## Procedure

1. Used Capa's actual `tools/codegen/src/cli.ts`, parser, emitter, and runtime template to generate `CloudflareReadCapability` from a one-operation OpenAPI document.
2. Deployed the generated capability Worker first with pinned Wrangler `4.103.0 --temporary` and an isolated home/config directory.
3. Read the short-lived token from Wrangler's private mode-600 temporary cache without printing it.
4. Piped it to `wrangler secret put CLOUDFLARE_READ_API_KEY --temporary`.
5. Deployed an Up caller Worker in the same Temporary Account with:

   ```json
   {
     "binding": "CLOUDFLARE",
     "service": "capa-cloudflare-read",
     "entrypoint": "CloudflareReadCapability"
   }
   ```

6. Called `env.CLOUDFLARE.accounts.list()` through JSRPC.
7. Redeployed the caller through the reused Temporary Account and repeated the call.
8. Queried the temporary account's Worker settings to verify the two Workers, secret binding, and service binding.

## Successful operation evidence

The live caller returned HTTP `200` with:

```json
{
  "capability": "cloudflare-read",
  "operationId": "listAccounts",
  "upstreamStatus": 200,
  "verdict": "pass",
  "assert": [
    {
      "kind": "httpStatus",
      "expected": "2xx",
      "actual": 200,
      "passed": true
    }
  ]
}
```

The result contained exactly one temporary account. The credential and `Authorization` header were absent from the response and evidence. The raw response SHA-256 was recorded during the run but is omitted because the result included a temporary account identifier.

After caller revision 2 was deployed, Wrangler reported the account as reused, the updated page was visible, and the same Capa operation still returned `verdict: pass`.

## Existing Capa catalog artifact test

The spike also tested the checked-in Stripe capability with a deliberately fake value:

```text
sk_test_up_capa_spike_deliberately_not_real
```

No real Stripe credential or side effect was possible.

### Capa `main`

Capa `main` at `382359f` deployed into the same Temporary Account and was bound as `STRIPE_MAIN → capa-stripe-main-spike.StripeCapability`.

Calling `env.STRIPE_MAIN.customers.list({ limit: 1 })` reached Stripe and returned a bounded proof:

```json
{
  "capability": "stripe",
  "operationId": "GetCustomers",
  "upstreamStatus": 401,
  "verdict": "fail",
  "result": null,
  "assert": [
    {
      "kind": "httpStatus",
      "expected": "2xx",
      "actual": 401,
      "passed": false
    }
  ]
}
```

The fake credential and authorization header were absent from the response and evidence. This proves the current mainline catalog Worker, secret, service binding, generated method, upstream fetch, and evidence path all function inside a Temporary Account.

### Local Capa rewrite branch

The local `rewrite/distilled-runtime` branch at `cfe48ab` also deployed and bound successfully, but its lazy provider operation was not included in the runtime bundle:

```text
No such module "../../node_modules/@distilled.cloud/stripe/lib/operations/GetCustomers.js"
```

Capa still returned a credential-free `fail` receipt, but it did not reach Stripe. Up must pin Capa `main` or another proven immutable revision until that branch fixes Worker bundling.

## Final temporary account inventory

The account contained four Workers:

- `up-capa-caller`
- `capa-cloudflare-read`
- `capa-stripe-main-spike`
- `capa-stripe-spike` (negative branch-compatibility test)

The caller had three exact service bindings. Each Capa Worker had only its expected `secret_text` binding. No Capa Worker had a public `workers.dev` route.

## Claim semantics

Cloudflare's Temporary Account documentation says claiming preserves the Worker and supported resources created in the account. The spike verified that every app Worker, capability Worker, secret, and service binding was in one account behind one claim URL.

The spike did **not** open the claim URL because that would make test resources permanent. Account transfer is therefore supported by the documented account-level claim contract and resource inventory, not by a destructive claim/unclaim experiment.

## Product conclusion

A local Up composer can safely model:

```text
Native bindings
  KV / D1 / Durable Objects

API capabilities by Capa
  install capability Worker
  set provider credential on that Worker
  bind caller by entrypoint
```

Capa Workers must be installed into the same Temporary Account. Existing permanent `capa-*` Workers cannot be service-bound cross-account.

The missing product layer is an immutable Capa install artifact/catalog contract. Up should not clone the entire Capa repository or generate large providers at deployment time. The first integration should pin one proven Capa revision and install one capability bundle with machine-readable:

- capability name;
- source revision;
- Worker entrypoint;
- required secret names;
- auth shape;
- operation count;
- bundle integrity hash.

## Security

- Claim URLs were redacted from every retained spike log.
- Temporary and provider tokens were never printed or passed as command arguments.
- The only non-temporary provider value was deliberately fake.
- Evidence contained no credential or authorization header.
- No permanent Cloudflare account, Worker, route, Access policy, DNS record, or Capa deployment changed.
- Local temporary state and all raw API responses were deleted after evidence extraction.
- The unclaimed remote account expires automatically.
