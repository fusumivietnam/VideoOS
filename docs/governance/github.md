# GitHub governance target

This document records the intended repository settings that are not fully represented by version-controlled files.

## Current operating model

- PR-first changes to `main`.
- One primary `CI / quality` workflow for architecture checks, typechecking, and tests.
- OpenCodeReview is manual-only.
- CODEOWNERS, issue forms, PR template, Dependabot, security policy, and contribution policy live in the repository.

## Target `main` ruleset

Configure a repository ruleset targeting the default branch with these minimum rules:

1. Block branch deletion.
2. Block force pushes.
3. Require a pull request before merge.
4. Require the `quality` status check from the `CI` workflow.
5. Require branches to be up to date before merge once parallel contributors make stale-base merges a practical risk.
6. Require code-owner review only after ownership is split across multiple maintainers; do not add ceremonial self-review requirements for a single-maintainer phase.

Avoid rules that add process without reducing a demonstrated risk.

## Repository hygiene settings

Recommended repository settings:

- Automatically delete head branches after merge: enabled.
- Allow contributors to update PR branches: enabled.
- Squash merge: enabled and preferred for focused feature branches.
- Merge commits/rebase: may remain available until the release process standardizes history.
- Discussions: leave disabled until an external user/community workflow exists.
- Wiki: documentation should normally live under `docs/` so it versions with code; disable Wiki when no independent wiki use case exists.
- Pages: enable only when publishing generated/static documentation becomes useful.
- Packages/GHCR: enable operational use only when deployable containers/binaries exist.

## Security settings

Where the repository/account plan supports them, enable:

- Dependabot alerts and security updates.
- Secret scanning and push protection.
- Code scanning using GitHub's default setup unless a custom query/build requirement appears.
- Private vulnerability reporting for responsible disclosure.

These are preferred over custom security workflows because native GitHub features reduce Actions usage and maintenance.

## Release policy

Do not create releases or publish internal workspace packages merely to use GitHub features. Start tagged releases and GHCR publishing when VideoOS has a deployable API/worker/local-node artifact and a defined compatibility boundary.
