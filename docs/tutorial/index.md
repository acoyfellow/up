# Tutorial: publish a company-private site

1. Click the Deploy to Cloudflare button in the README.
2. Create `up.example.com` and `*.up.example.com` in a zone owned by the same account.
3. Create one Access application that protects both hostnames for your organization.
4. Configure `TEAM_DOMAIN`, `POLICY_AUD`, `CONTROL_HOST`, `SITE_DOMAIN`, and administrators.
5. Disable `workers.dev` and Preview URLs, then attach production routes.
6. Open `/app`, choose a folder containing `index.html`, and publish.
7. Verify the returned site while authenticated.
8. Open it in an isolated browser. Access must challenge the browser before uploaded content appears.

You now have one private publishing plane that can host many static company sites.
