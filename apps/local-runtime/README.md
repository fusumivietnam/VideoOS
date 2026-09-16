# Local runtime composition

This app is the executable composition root for the dependency-light VideoOS vertical slice. It wires the API facade, in-memory identity/storage/queue/event adapters, deterministic queue runner, media worker, and publisher service without introducing production infrastructure.

The smoke test proves two canonical paths:

- `API -> queue(media) -> QueueRunner -> MediaWorker -> MediaExecutor`
- `API -> queue(publish) -> QueueRunner -> PublisherService -> NetworkPublisherAdapter`

Both paths emit queue lifecycle events and are observable through the project-authorized job-status API.

Run through the workspace with `pnpm test`, or only this app with:

```bash
pnpm --filter @videoos/local-runtime test
```

Production adapters replace the in-memory/fake edges behind the same ports; they do not change this orchestration shape.
