# TriRMC 迁移蓝图（路径 B 资产双跑迁入）

## 文档同步元信息

- sourceOfTruth: TriRMC/MIGRATION.md
- syncMode: source-only
- lastSyncedAt: 2026-08-22

## 〇、裁决与边界

- 裁决：路径 B（TriMC 自研 agent loop）服务设施迁 TriRMC 作为服务域种子；TriMMC 收窄为元虚拟主控（路径 A 资产：session-bridge + orchestration 桥面 + policy-gate / cost-controller 中与桥相关部分）（R4 §3.3 方案 A；CEO 2026-08-21 决策①批准）。
- 本蓝图只登记迁移设计，不等于迁移已开始；执行归期 2（W36-W38）各批，批清单预告见 `STATE.md`。
- 立项批（TMV-P1-5）纪律：零代码搬运、零 TriMC 仓改动。
- 种子资产清单（来源事实 R1-trimc-inventory.md）：agent-loop（薄壳/DI 层，agent-core 消费）、cron（service/routes/command-handler）、contracts（resolver）、onboarding（session-initializer）、config-sync（五维接收）、observability（PG）、comm（离线事件仲裁）；装配面 pipeline（contract→soul→context→loop）与 server 骨架随骨架归位批。
- 不迁移（留 TriMMC）：session-bridge、orchestration 桥面、policy-gate / cost-controller 桥相关部分、node-bridge（空壳）。
- parity 合规：TriRMC 从路径 B 资产生长，不从 TriLC 拷贝重写第二套（trilc-trimc-runtime-parity V1.1 §1）。

## 一、批项 1：server 骨架 / HTTP 面归位（1 批）

- 来源模块：TriMC `src/server`（app.ts 13 路由）+ `src/agent-loop` + `src/pipeline` + `src/contracts` + `src/onboarding`（路径 B loop 装配链，agent-core 8 文件消费面）。
- 目标形态：TriRMC server 骨架 + HTTP 面；agent-core ADE runtime + service adapter（PostgreSQL / 集群 / webhook）；部署参照 TriMC manifests（docker-compose trimc+postgres16、k8s、systemd 降权）。env 三外部接线预留（tristaciss / openclawGateway / vscodiumGlue）随本批评估承接。
- 双跑策略：TriRMC 新起服务域部署面，不承接流量；TriMC 现服务不中断。
- 回滚：新增部署面零流量即零影响，停用 TriRMC 实例即可。

## 二、批项 2：cron 周平面五段链双跑（2 批，含双跑＋切换）

- 来源模块：TriMC `src/cron`（对标 TriLC 契约的装配面，消费 agent-core JobExecutor / job-store）；周平面五段链已投产（prod-grade-1 树 + 周日 23:00 自然触发在案）。
- 目标形态：TriRMC cron 承接周平面调度（7×24 daemon 常驻形态）。
- 双跑策略：双跑窗口两链并行，对照基线＝开业（I5）验收结论；切换窗口只选周日触发完成后。
- 回滚：TriMC 侧原链在切换验收前不拆除，异常即切回；切换后首个周日人工盯守（REHEARSAL-20260813 三端同步 + 属主污染教训）。

## 三、批项 3：config-sync 五维接收迁移（1 批）

- 来源模块：TriMC `src/config-sync`（fleet bundle→applied.json 五维同步接收侧）。
- 目标形态：TriRMC 承接五维接收端（bundle→git→push→cron 拉取→schema 校验→applied.json 链的接收侧）。
- 双跑策略：接收端切换前后以 applied.json 版本比对对照；I4 产线 43/43 基线为验收对照。
- 回滚：TriMC 接收端保留可切回；载体是 TriCompany 仓本身，git 侧不受切换影响。
- 互锁门：开业（I5）闭环必须先于本项切换完成（R6 §3.1——开业是第一个协同工作，其验收结论是迁移双跑的对照基线，反序会让验收问题无法归因）。

## 四、批项 4：接收面（心跳/镜像/events）（1 批）

- 来源模块：TriMC 入向 HTTP——`POST /internal/v1/heartbeat`（TriLC 节点心跳）+ `POST /internal/v1/events/replay`（离线事件 replay→comm 仲裁 winner-takes-last）；`src/mirror`（内存 Map 镜像，MVP）。
- 目标形态：TriRMC 接收端；TriRLC 改指向 TriRMC，协议不变（R4 bridge-3 裁决「直接复用」）。
- 双跑策略：指向切换随本迁移批走（心跳/镜像/五维改指向 0 额外批，R6 §1.3）。
- 回滚：TriRLC 指向回切 TriMC 即回滚（协议零变更保证可回切）。
- 待确认：TriMC 侧 Python heartbeat 独立进程（IPD case 心跳 + session-resume hook，R1 标【推断】）的归属随本批摸底定案，不在本蓝图预判。

## 五、批项 5：observability PG（1 批，可选，可后置期 3/4）

- 来源模块：TriMC `src/observability`（PG timeline replay + benchmark gate）+ `sql/init_observability_tables.sql`。
- 目标形态：TriRMC PG 观测面（PostgreSQL 16 同栈容器）。
- 双跑策略：观测面独立启用，新库并行写入对照（TriMC 持久化仅 observability PG，R1 实证）。
- 回滚：PG 面独立，停用不影响执行链。

## 六、期 2 新增面（非迁移，预告）

- 会话投影 push 两端激活（2 批）：TriRLC 发送端改推送投影 + TriRMC 接收端落 PG（参考 sync-engine 状态机/409 幂等/退避工程模式）；schema 核对专项归期 1（TMV-P1-8 产出字段对齐表为验收基线）；写权威护栏＝投影 push 携带 parity §5 双域写权威元数据（本地 owned 会话在 TriRMC 侧是只读投影）。
- 只读投影 API 三端点（2 批）：`GET /internal/v1/projection/agents` / `sessions` / `sessions/{id}`；数据源三路（TriRMC 自有存储 / TriRLC 投影 push / TriMMC 名册桥经 bridge-1 list，可后置）。

## 七、CI 接线（登记，本批不执行）

- 后续批内容：`TriMetaverse/.github/workflows/build-tricade.yml` 增加 TriRMC checkout。
- 前置依赖：CI 断链修复已完成（TMV-P1-3，commit 4a4b2e6a，working-directory 改指 TriCompany/packages/agent-core canonical 真源），接线批不再被其阻塞。
- 本批不改 workflow 文件（立项批纪律：TriMetaverse 侧仅架构文档一行改动，避免与 CI 修复窗口冲突）；接线归期 2 骨架归位批或独立 chore 批。

## 八、使用依据

- tmv-minimal-restructure-analysis 树（TriMetaverse/docs/workflow/operating-records/2026-W34/trees/）：R1（TriMC 盘点：路径 A/B 隔离、agent-core 8 文件、23 模块功能面、部署形态、通信现状）、R4（§3.3 路径 B 归属裁决、§2.3 bridge-3 逐面裁决、§五 只读投影 API、§七 安全模型）、R6（§1.2 TriRMC 两案对比与批构成、§3.1 开业互锁、§四风险 12/13/17、§五期 2 批构成）
- tmv-restructure-p1 tree-op.json（TMV-P1-3 / TMV-P1-5 批定义）
- TriCompany/docs/engineering/trilc-trimc-runtime-parity.md V1.1（§1 不重写第二套 / §5 双域写权威）
- TriMetaverse/docs/三元宇宙架构与模块说明.md v0.5 §4 TriRMC 行（模块定位中央口径）
