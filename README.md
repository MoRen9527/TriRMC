# TriRMC

TriRMC（Reality Main Controller，元现实主控）是三元宇宙元现实系统的服务域主控模块。

## 文档同步元信息

- sourceOfTruth: TriRMC/README.md
- syncMode: source-only
- lastSyncedAt: 2026-08-22

## 模块定位

- 与 `TriRLC`（元现实本地控制器，原 `TriLC`）共用自研内核 `agent-core`（ADE runtime），构成元现实系统最小实现。TriRMC 承接服务域 service adapter（PostgreSQL / 集群 / webhook），TriRLC 承接本地域 local adapter（SQLite / 本地 cron / TUI / 文件工具）。
- 承接必须自持的生产面：稳定执行、无人值守（cron 周平面调度）、权限审计与跨节点协同。
- 与 TriRLC 的通信面（bridge-3）：心跳、任务镜像、五维配置同步直接复用既有面（协议不变）；会话投影 push 与只读投影 API 为规划中的新增面。
- 不承接 claude code 宿主桥职能——那是 `TriMMC`（元虚拟主控，原 `TriMC`）的路径 A 资产（session-bridge 等）。

## 种子来源（路径 B 资产双跑迁入）

- 本模块以现 TriMC 自研 agent loop（路径 B）服务设施双跑迁入为种子（CEO 2026-08-21 决策①批准；裁决依据 tmv-minimal-restructure-analysis R4 §3.3 方案 A）。
- 种子资产清单（来源事实：R1-trimc-inventory.md）：agent-loop、cron（周平面五段链）、contracts、onboarding、config-sync（五维接收）、observability、comm 仲裁。
- 迁移主体归期 2（W36-W38），迁移蓝图见 `MIGRATION.md`；当前仓库为零代码立项态，TriMC 侧路径 B 资产仍在原址运营（周平面 cron / 五维接收不间断）。

## 服务域形态

- 部署形态参照 TriMC manifests：docker-compose（服务 + PostgreSQL 16）、k8s、systemd + 降权运行。
- 安全基线（R4 §七裁决）：绑定回环或内网面（ssh / VPN 入口），禁止裸公网；写面 token 与只读投影面独立只读 token，读写分离。

## 当前状态

- 已立项（2026-08-22，批次 TMV-P1-5）：仓库骨架 + 新模块四件套标准配套到位，零代码。
- 详细状态与期 2 迁移批清单预告见 `STATE.md`。

## 事实源指引

- 模块定位与状态：`README.md`、`STATE.md`
- 迁移蓝图：`MIGRATION.md`
- 模块 registry agent 入口（canonical discovery）：`.github/agents/`
- 发布条目登记：`../TriCompany/source-agents/registries/trimetaverse-live-agent-publish-manifest.json`（module-local-live-entry）
- 架构定位中央口径：`../TriMetaverse/docs/三元宇宙架构与模块说明.md` §4
