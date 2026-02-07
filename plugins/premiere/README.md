# Premiere Pro Plugin Scaffold

Phase 2 target with iterative parity against web `/v1` APIs.

## Planned capabilities
- OAuth auth-code/device login
- Browse team workspace folders/assets
- Import cloud media into timeline
- Export timeline renders to workspace assets
- Trigger image/video generation and monitor status
- ETag/version-aware local cache manifest

## API contract
Uses the same `/v1` backend endpoints as web for:
- `drive`, `versions`, `generation`, `sharing`, `workspace`
