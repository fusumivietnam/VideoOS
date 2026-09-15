# VideoOS Infrastructure

Infrastructure is kept separate from product/domain logic and should support local development, self-hosting and cloud deployment without changing core contracts.

Planned areas:

- containers and reproducible local stack;
- deployment manifests;
- database/object-storage/queue configuration;
- OpenTelemetry collection and dashboards;
- secret management integration;
- backup/restore and disaster recovery;
- staged rollout and rollback tooling.

Infrastructure changes are security-sensitive and receive focused OpenCodeReview rules plus human review when they affect credentials, networking, persistence or production access.
