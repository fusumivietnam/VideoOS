# VideoOS Contracts

Canonical, versioned schemas shared across service boundaries.

Start with contracts for:

- ProjectManifest
- AssetRef
- TimelineManifest
- WorkflowDefinition / WorkflowRun
- JobEnvelope
- PublishRequest / PublishResult
- ChannelConnection
- EventEnvelope
- MetricSnapshot
- AgentTask / AgentResult

Compatibility is backward-first. Provider/editor/network-specific objects must be translated by adapters and must not become canonical contract shapes.
