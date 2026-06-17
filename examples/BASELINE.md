# Baseline site

A deterministic, dependency-free folder for manual and automated Up publishing tests.

## Publish

Choose the **`baseline-site` folder itself** in the Up folder picker. Suggested site name:

```text
baseline
```

## Expected result

- The page heading reads **“The deployment is complete.”**
- HTML, CSS, and JavaScript each show `loaded` in green.
- Identity shows the authenticated Access email.
- `/assets/mark.svg` renders as the favicon.
- `/baseline.txt` returns `UP_BASELINE_OK`.
- A clean unauthenticated browser cannot read either page or text asset.

Do not add timestamps, external dependencies, generated files, or random content. Stability is the point.
