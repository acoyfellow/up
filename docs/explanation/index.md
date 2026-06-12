# Explanation: why the trust boundary is the product

Shopify Quick demonstrated that a folder, a URL, and a company trust boundary can change how employees build and share. Inhouse isolates that mechanism as an OSS Cloudflare-native product.

An installation belongs to the customer’s account. A wildcard Access application establishes organization identity once. Private R2 holds immutable assets. A Durable Object serializes deployment authority. The serving Worker verifies identity again before reading content.

The control plane and generated sites are different trust zones. Generated JavaScript receives no bindings or secrets and cannot mutate the control plane cross-origin. Identifiers are never treated as credentials.

This is intentionally narrower than a general application platform. The fixed constraint—static sites private to the organization—is what keeps installation and operation understandable.
