# Scheduled jobs

Up runs a single trusted scheduler every minute. Site schedules are registry records; they do not create arbitrary account-level cron triggers.

A schedule targets an `/api/*` route handled by the active deployment's isolated `_worker.js`:

```json
{
  "path": "/api/jobs/hourly",
  "cron": "0 * * * *",
  "maxRunsPerDay": 24,
  "retryLimit": 3
}
```

Supported expressions are minute intervals (`*/15 * * * *`), hourly minutes (`0 * * * *`), and daily UTC times (`30 9 * * *`).

## Safety model

- only owners and Up administrators can manage schedules
- schedules require a published site
- states are `enabled`, `paused`, and `disabled`
- the registry atomically leases due work for five minutes
- each attempt counts against the UTC daily quota
- failures retry with exponential backoff, capped at one hour
- exhausted retries advance to the next cron occurrence
- paused, disabled, over-quota, or unpublished sites do not execute
- each create, update, delete, success, failure, and quota skip creates a bounded audit record
- audit records contain path, cron, state, attempt, and HTTP status—never code, secret values, response bodies, or stack traces

The scheduled request includes `x-up-schedule` plus a JSON body containing the schedule ID, scheduled time, and attempt number. It runs under the same Dynamic Worker CPU, subrequest, network, database, and secret-capability restrictions as an interactive backend request.
