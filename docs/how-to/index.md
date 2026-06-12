# How-to guides

## Update a site

Publish the same site name. Assets enter a new immutable deployment; only complete verified deployments can replace the active pointer.

## Add administrators

Update `ADMIN_EMAILS` with normalized comma-separated addresses. Site creators can always update their own sites.

## Recover from a suspected exposure

1. Disable the wildcard route or deny the Access application.
2. Confirm `workers_dev` and Preview URLs remain disabled.
3. Inspect deployment and Access logs without serving uploaded content.
4. Restore only after an isolated anonymous request proves denial.

## Prepare an agent-authored site

Tell the agent to output static files, include `index.html`, use no server secrets, and keep individual files under the configured limit. Review the folder before publishing.
