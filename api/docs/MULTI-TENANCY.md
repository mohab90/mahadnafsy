# Multi-tenancy status and rollout boundary

**Current status:** the application has an operational multi-tenant control
plane and tenant-scoped runtime suitable for controlled pilot use. It is not yet
a sellable enterprise SaaS product.

## Implemented and verified

- Canonical tenant resolver with fail-closed unknown/suspended tenant handling.
- Tenant-scoped JWT identities, users and same-email accounts across tenants.
- Tenant-scoped CRM, HR, LMS, finance, support and operations paths covered by
  automated tests and a live Tenant A/B staging smoke.
- Tenant provisioning, plan assignment, feature flags, quotas, branding and
  custom-domain verification.
- One current plan-backed subscription enforced for each active tenant.

## Required before enterprise SaaS claims

1. Usage metering tied to billable dimensions and immutable monthly snapshots.
2. Institute invoicing, collection, dunning, credits, taxes and reconciliation.
3. Provider-backed subscription charging after the payment-gateway review.
4. Managed MySQL/Redis, regional backups, observability and incident routing.
5. Contractual data-residency evidence and tenant restore/export drills.
6. Capacity, noisy-neighbour and failover tests on the actual production topology.

Until those gates pass, product and sales material must use “controlled
multi-tenant pilot” and must not use “enterprise SaaS ready”.

## Rollout

- Pilot: named tenants, capped users, manual billing, monitored migrations and
  a documented rollback window.
- Limited availability: metering and tenant billing enabled, restore/failover
  drills passed, support runbooks staffed.
- General availability: contractual SLOs, regional evidence, scale results and
  independent security review accepted.
