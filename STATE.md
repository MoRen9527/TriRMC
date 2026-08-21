# TriRMC 立项状态

## 文档同步元信息

- sourceOfTruth: TriRMC/STATE.md
- syncMode: source-only
- lastSyncedAt: 2026-08-22

## 立项事实

- 立项日期：2026-08-22
- 立项批次：TMV-P1-5（期 1「定名立项＋开业互锁」TriRMC 立项批，R6 §五）
- 决策依据：CEO 2026-08-21 决策①——路径 B 资产迁入为种子（否决全新建：差值 +3-5 批，且含重做已投产周平面链的纯迁移风险与「换 codex 不真」代价）
- 架构依据：R4 §3.3（路径 B 归属裁决方案 A）/ §2.3（bridge-3 逐面裁决）/ §七（安全模型）；R6 §1.2（TriRMC 两案对比）/ §3.1（开业互锁）
- 当前状态：已立项——仓骨架＋立项四件套落盘；零代码（只立项不迁移：零代码搬运、零 TriMC 仓改动，迁移主体归期 2）

## 立项四件套清单（AGENTS 对齐 TODO ⑥ 新模块标准，与 TMV-P1-4 TriMLC 同口径）

| 件 | 落点 | 状态 |
| --- | --- | --- |
| AGENTS.md 五段式模板 | `TriRMC/AGENTS.md` | 已落 |
| registry 三件套（contract 化轻量声明） | `TriRMC/.github/agents/TriRMCBusinessStrategyRegistry.agent.md`、`TriRMCProductRegistry.agent.md`、`TriRMCCodeRegistry.agent.md`（各内嵌「模块合同」段） | 已落；正式 `.contract.yaml` 与运行时加载归 TODO-3 定调后再补 |
| manifest 登记 | `TriCompany/source-agents/registries/trimetaverse-live-agent-publish-manifest.json`（module-local-live-entry × 3） | 已登记 |
| 知识命名空间预留 | `module/trirmc`（见下节声明） | 已声明 |

口径注：R6 §1.2 表述为「contract/agent-body/registry/发布条目」，与 `agent-governance-alignment-design.md` §六 定义（AGENTS.md 模板 / registry 三件套 / manifest 登记 / 知识命名空间预留）有出入；本立项按文档定义执行（与 TriMLC TMV-P1-4 同口径）。

## 知识命名空间预留

- 命名空间：`module/trirmc`（模块记忆＋知识注入内容层，AGENTS 对齐 TODO ⑥ 第 4 件）
- 当前为预留声明；runtime 认知侧命名空间扩展机制归 AGENTS 对齐 TODO-8，未接线前本命名空间无消费方。

## 期 2 迁移批清单预告（R6 §1.2 方案 A + §五期 2 批构成）

| # | 批项 | 批数 | 备注 |
| --- | --- | --- | --- |
| 1 | server 骨架 / HTTP 面归位（路径 B loop/pipeline） | 1 | 详见 MIGRATION.md §一 |
| 2 | cron 周平面五段链（含双跑＋切换） | 2 | 详见 MIGRATION.md §二；周日 23:00 硬时点互锁 |
| 3 | config-sync 五维接收迁移 | 1 | I4 产线 43/43 基线为验收对照 |
| 4 | 接收面（心跳/镜像/events） | 1 | TriRLC 改指向，协议不变 |
| 5 | observability PG | 1（可选） | 可后置期 3/4 |
| 6 | 会话投影 push 两端激活 | 2 | 非迁移（新增面）；schema 核对归期 1 TMV-P1-8 |
| 7 | 只读投影 API 三端点 | 2 | 非迁移（新增面） |

## 依赖门与互锁（迁移放行前置）

- 开业（I5）闭环必须先于 TriRMC 迁移切换完成（期 1/期 2 互锁门，R6 §3.1——开业验收结论是迁移双跑的对照基线，反序会让验收问题无法归因）。
- cron 切换窗口只选周日 23:00 触发完成后；切换后首个周日人工盯守（R6 风险 12，REHEARSAL-20260813 三端同步＋属主污染教训）。
- 服务器 ssh 窗口需求提前汇总排期（R6 风险 13）。
- CI 断链修复（TMV-P1-3）已完成（commit 4a4b2e6a），CI 接线后续批不再被其阻塞。

## 待办（后续批次）

1. git init ＋ dev 分支 ＋ 首次 commit（编排层补，本批无 shell 权限）
2. workspace folders 登记（`trimetaverse.code-workspace` 追加 `../TriRMC`）＋治理文档仓库清单登记（`github-repo-governance.md` §1.1）——归编排层
3. `docs/` 六件套骨架（engineering/product/registry/workflow/training/execution）——架构文档 §2 模块骨架纪律项，本批未建；缺失标配按治理条款由 CTO 发现当轮或下一轮优先补齐
4. 本地 CodeGraph 初始化——同上骨架纪律项，本批未建；补齐责任同上（CTO 当轮或下一轮优先补齐）
5. CI 接线（`build-tricade.yml` 增加 TriRMC checkout）——依赖登记见 MIGRATION.md §七，归期 2 骨架归位批或独立 chore 批
6. 期 2 迁移主体执行（批清单见上表预告；先决＝开业闭环）

## 架构定位参照

- R4 目标态：agent-core ADE runtime + service adapter（PostgreSQL/集群/webhook）；吸收 cron（周平面）/config-sync（五维接收）/observability/comm 仲裁；新增只读投影 API（会话/任务/名册，供 TriRLC 聚合代理拉取）。
- 安全目标态：回环或内网面（ssh/VPN 入口），禁止裸公网；写面 token + 只读投影面独立只读 token（R4 §七）。
- 元现实内通信（bridge-3）协议统一 HTTP+SSE（与 TriRLC 同构栈）。
