# TriMC

TriMC is the unified agent runtime and interaction core for TriMetaverse.

Current boundary:

- During the current copilot-host stage, both shadow and formal takeover still run directly on Copilot as the active host.
- TriMC now represents the unified runtime-side boundary for service-domain execution and the R&D workflow slice.
- TriHost is the planned host-adaptation and cutover layer for the go-live stage.
- Tride remains part of the PC-side software stack and is not the formal host of the R&D workflow.
- The virtual company remains the business and interaction carrier, not a third infrastructure host.

Responsibilities:

- host the unified runtime core for service-domain execution and the R&D workflow slice
- bridge OpenClaw gateway semantics and node execution lifecycle
- enforce confirmation, high-risk interception, and privacy protection
- dispatch tasks to TriLC nodes
- aggregate execution, audit, and settlement events
- absorb the core-agent observability and replay subsystem
- extend planner, context, tool orchestration, and model-call capabilities as code lands

Stable OpenClaw baseline:

- vendor/openclaw: vendored stable OpenClaw source snapshot at version 2026.3.28
- this snapshot is the starting point for evolving OpenClaw into the TriMC runtime shadow baseline

Planned modules:

- src/server: bootstrap and HTTP surface
- src/task-controller: task state machine and orchestration
- src/node-bridge: OpenClaw node and gateway integration
- src/policy-gate: approval, risk, and privacy gate
- src/contracts: shared protocol contracts
- src/observability: audit mapping, timeline query, replay, and SQL stores

Observability migration baseline:

- `src/observability/contractSamples.ts`: migrated sample event source for mapper and replay tests
- `test/*.test.ts`: migrated baseline tests from `core-agent`
- `sql/init_observability_tables.sql`: migrated Postgres bootstrap for timeline/replay tables

Useful commands:

- `npm run check`
- `npm test`

## Deployment Topology (BOD SSH survey 2026-09-13 22:4x)

> **Naming note**: This README still uses pre-rename names (TriMC/copilot-host/Tride/TriLC).
> Full rename to TriRMC terminology is a pending work item (tracked in LG-035).
> The deployment topology below uses current names.

| Entity | Domain binding | Host | Region | Deploy path | Port | CLI |
| --- | --- | --- | --- | --- | --- | --- |
| TriMMC (M面) | sg | sg-ecs-server | ap-southeast-1 (Singapore) | /srv/fleet/TriMMC | 8710 | trimmc chat |
| TriRMC (R面) | 河源 | sg-ecs-server (同机) | ap-southeast-1 (Singapore) | /srv/fleet/TriRMC | — | trirmc chat (待建) |
| TriRLC (本地) | 本机 | TABLET-0BGCRCP5 | — | D:\Code\ai\TriRLC | 8711 | trirlc chat |
| TriMLC (本地通道) | 本机 | TABLET-0BGCRCP5 (同机) | — | %LOCALAPPDATA%\trilc-channel | 8713 | trimlc chat |

- **sg 与河源 = 同机双域名**（sg-ecs-server 绑 TriMMC/M 面 + 河源绑 TriRMC/R 面）；M/R 分机部署为终态。
- TriRMC deploy: fleet 属主, /srv/fleet/TriRMC, 2026-08-27 15:21（非 git 工作拷贝）。
- TriMMC deploy: 同机 TriMMC(8710) 端口共存。
- CLI 正名四件（trimlc/trirlc/trimmc/trirmc）：候专项窗（CEO 22:36 口谕）。
- README 全面重写（旧名旧概念→TriRMC 正名体系）：候办（LG-035 登记）。
