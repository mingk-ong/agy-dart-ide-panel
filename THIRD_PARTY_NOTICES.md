# Third-Party Notices

This extension (`agy-fusion-panel`, evolved from `agy-dart-ide-panel`) incorporates clean-room adaptations and protocol/UI patterns from the following MIT-licensed open-source projects:

1. **agy-dart** (https://github.com/zou172866/agy-dart)
   - License: MIT
   - Scope: Hosted Sidecar dashboard bridge, `/api/*` proxy integration, and IDE theme/dialog adaptation.

2. **agy-capsule** (https://github.com/Lumidarin/agy-capsule)
   - License: MIT (Copyright (c) 2026 Lumidarin)
   - Scope: Read-only local SQLite + Protobuf telemetry decoding (`gen_metadata`, `steps`, `executor_metadata`), Language Server quota RPC discovery, 8-category request error classification, first-token wait alerting, and incremental usage heatmap/by-model aggregation.
