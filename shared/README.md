# Shared

Shared TypeScript contracts for code that is used by more than one app surface.

Keep this package dependency-free. Move only stable domain contracts here, then import
them gradually from `admin`, `client`, and API TypeScript tooling.
