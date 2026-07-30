# Data residency release evidence

Production readiness must remain blocked until the deployment owner records all
of the following values from the actual hosting provider:

- `DATA_RESIDENCY_PROVIDER`: legal provider/account identity.
- `DATA_RESIDENCY_REGION`: the exact database, object-storage and backup region.
- `DATA_RESIDENCY_VERIFIED_AT`: the date the live resources were inspected.
- `DATA_RESIDENCY_EVIDENCE`: immutable contract, provider export or evidence-object reference.
- `DATA_RESIDENCY_EVIDENCE_SHA256`: SHA-256 of that reviewed artifact.

The evidence artifact must show the live MySQL region, backup/replica regions,
object-storage region and any subprocessors that can persist customer data.
Screenshots without the resource/account identity are insufficient. If any
resource is multi-region, global, or outside the approved region, document it
as an exception and keep the release gate failed until it is accepted by the
deployment owner and legal/privacy reviewer.

Do not copy example values into production. Run `npm run readiness:production`
from `api/` after the evidence is stored and the environment variables are
injected by the deployment platform.
