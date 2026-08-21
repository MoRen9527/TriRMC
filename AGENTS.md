# TriRMC Agent Rules

## Module Role

- TriRMC 是元现实主控（服务域）模块。
- 它与 TriRLC 共用自研内核 agent-core，承接服务域稳定执行、无人值守调度（cron 周平面）、权限审计、跨节点协同与只读投影面。
- 当商业模式涉及服务域无人值守执行、周平面调度、生产面观测或跨节点协同时，必须考虑本模块。

## Strategy Delegation

- 总商业模式、当前实验是否需要服务域优先、模块边界变化，先咨询 `TriMetaverse/BusinessStrategy`。
- TriRMC 不承接 claude code 宿主桥职能（那是 TriMMC 的路径 A 资产）；`core-agent` 只能作为历史 observability 迁移源，不应被当作现役主控。

## Local Fact Sources

- 模块定位与状态：`README.md`、`STATE.md`
- 迁移蓝图：`MIGRATION.md`
- 治理事实：`../TriMetaverse/docs/三元宇宙架构与模块说明.md`（§4 模块表）
- 代码事实：当前零代码；期 2 迁移落地后以 `src/` 为准

## Current Registries

- `TriRMCBusinessStrategyRegistry`
- `TriRMCProductRegistry`
- `TriRMCCodeRegistry`

当前 registry agent canonical discovery 位于 `TriRMC/.github/agents/`，已在 TriCompany 发布 manifest 登记（module-local-live-entry，`TriCompany/source-agents/registries/trimetaverse-live-agent-publish-manifest.json`）。同名中央 discovery 文件不应在 `TriMetaverse/.github/agents/` 并行保留；中央只通过 manifest 和 registry closeout 工作流路由本模块 registry。

## Update Discipline

- 不把立项态写成生产能力；不把「双跑迁入规划」写成「已迁移」。
- 迁移进度事实只认 `MIGRATION.md` 与执行记录（operating records），不凭记忆改写。
- TriRMC ≠ TriMC（TriRMC 是全新名；TriMC 是 TriMMC 的历史兼容路径名，消歧条目见架构文档 §5）；两名词不得混用。
- 当前事实不足时标为待确认，尤其不要虚构服务域成熟度与迁移完成度。
