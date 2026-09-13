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

## Deployment Topology (BOD SSH survey 2026-09-13 22:4x; CEO 22:48 定谳修正)

> **Naming note**: This README still uses pre-rename names (TriMC/copilot-host/Tride/TriLC).
> Full rename to TriRMC terminology is a pending work item (tracked in LG-035).
> The deployment topology below uses current names.
>
> **Canonical server naming (CEO 22:48 立规)**: `M-SG-<ip>` / `R-HY-<ip>` (面+地域+IP 三重防混)。

| Entity | Domain binding | Canonical name | IP | Region (Alibaba Cloud) | Deploy path | Port | CLI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TriMMC (M面) | sg (M-SG) | **M-SG-47.245.122.61** | 47.245.122.61 | ap-southeast-1 (Singapore) | sg /srv/fleet/TriMMC | 8710 | trimmc chat |
| TriRMC (R面) | 河源 (R-HY) | **R-HY-8.155.54.79** | 8.155.54.79 | cn-heyuan (广东河源) | R-HY /srv/fleet/TriRMC | 8710/8711/8712 | trirmc chat (待建) |
| TriRLC (本地) | 本机 | TABLET-0BGCRCP5 | — | — | D:\Code\ai\TriRLC | 8711 | trirlc chat |
| TriMLC (本地通道) | 本机 | TABLET-0BGCRCP5 (同机) | — | — | %LOCALAPPDATA%\trilc-channel | 8713 | trimlc chat |

- **sg 与河源 = 两台独立阿里云 ECS 实例**（M-SG-47.245.122.61 ap-southeast-1 新加坡 / R-HY-8.155.54.79 cn-heyuan 广东海源）——非同机双域名。
- TriRMC deploy: fleet 属主, R-HY /srv/fleet/TriRMC, 2026-08-27 15:21（非 git 工作拷贝）。
- sg 机上 /srv/fleet/TriRMC 目录=已于 2026-09-13 归档下架（BOD 亲办：mv 至 M-SG /srv/fleet/.quarantine/TriRMC-stale-20260913，附 README 复原说明；复原=mv 回原位）。
- R-HY 侧 8710/8711/8712 三监听端口定性候勘（为何 R 面机上有 8710/M 面端口——残留或双角色，实勘回报）。
- CLI 正名四件（trimlc/trirlc/trimmc/trirmc）：候专项窗（CEO 22:36 口谕）。
- README 全面重写（旧名旧概念→TriRMC 正名体系）：候办（LG-035 登记）。
- 定名规则入工程纪律册：CEO 立规「以后机器一律 M-SG-ip / R-HY-ip 式命名，防面与名搞错」。

### 四域核心对照表（CEO 00:00 定谳）

| 四格 | 面 | 域 | 核心 daemon | 端口 | CLI |
| --- | --- | --- | --- | --- | --- |
| TriMMC | M 面 | 服务域（sg） | M-SG-47.245.122.61 | 8710 | trimmc chat |
| TriMLC | M 面 | 本地域（本机） | TABLET-0BGCRCP5 | 8713 | trimlc chat |
| TriRMC | R 面 | 服务域（河源 R-HY） | R-HY-8.155.54.79 | 8710/8711/8712 | trirmc chat（待建） |
| TriRLC | R 面 | 本地域（本机） | TABLET-0BGCRCP5 | 8711 | trirlc chat |

- 四格各一核心，面×域绑定写死（CEO 00:00 定谳）；本地周平面回流自动化宿主=**8713 TriMLC cron**（BOD 22:36 误派 8711 已勘正）。
