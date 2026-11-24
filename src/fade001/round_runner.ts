// ── FADE-001 D7 起跑接线·round_runner（loop 引擎宿主） ──
// D1 卷 cto-round-programming-design-20261119 §一 loop 本体照铸（v2 主形·WO-D7-TONIGHT §四起跑接线令面）。
// 主形定谳：loop 本体=runner 内单程序内聚循环控制流（while＋状态机）——点火后循环体内自主迭代推进；
// 前版「每轮一指令·队列接力」形=单轮开工指示器非 loop（勘正承录）。
//
// 三层判据族分野（cto-d6d7 勘面卷 §一）：挡位边（activation_gate 一次性）≠轮转边（EXIT≥95 每轮判）
// ≠质量边（retry<90 close 毕判）——本件承载轮转边+FUSE·零消费对方产物零分支交叠。
// 四分支族（§七.3）：挡位边/轮转边/质量边/续跑边（resume pending）——各读各卷。
//
// 四护栏常位（CEO 意见⑥·改造后原样保留）：
//   ①8 轮 FUSE（本件 round_count>=8 熔断·D1 §一 L21 照铸·值面=8 与 D1 定谳同值）
//   ②GLM 速率护栏=GLM 轨单跑纪律面（同窗并发 1·D1 L91 固化——值席/编排面守·本件零并发点火）
//   ③token 值面禁进转报=D-46（本件报文/载荷构造面全白名单投影·零原始卷 dump）
//   ④D-47 时刻制（本件报文落款=date 现查原值粘贴形·调用面传时刻串非件内推算）
//
// D6 gate 接线（起跑前置检查位·勘面卷 §七.2）：check_activation 判读输出挂点火前置——
// gate=ready 方可入 while 体（子进程 CLI 调 TC 检出 activation_gate.py --checks-json·施工选定形
// 候 CTO 终审注——fsd-d7-launch-wiring-preflight-20261120 §一）。
// first_round_pending=stop 语义（§三）：首轮毕（close 段毕+verdict 面）→停点挂起候 CEO 知情放行
// ——放行令=令面非时面（authority_ref 在=released·无 ref=拒绝 fail-closed）——放行一次非逐轮放行。
//
// resume 轮间指令面（D1 §六A·勘面卷 §七.3 续跑边）：retry_flag.json pending-retry 轮→
// 下轮点火指令携带 resumeStage=7（D5 拟稿 schema 承·--resume-stage 7 形）。

import { SPAWN_STAGE_TIMEOUT_MS, appendPyPath } from './chain_runner.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

export const FUSE_MAX_ROUNDS = 8;          // ①8 轮 FUSE 值面（D1 §一 L21 定谳值·边界案=F-2 7→8 钉）
export const EXIT_GATE = 95;               // 轮转边 EXIT≥95→prod（≥95 含边界·唯一程序自动边）
export const RESUME_STAGE_RETRY = 7;       // resume 段号=score 段（D5 拟稿 schema 承）

// P4 四态（CTO 定谳 7c389cac3 §三·CEO ③④）：prod / test / debug / joint_review（联审·debug 内嵌形——
// joint_review 为 debug 的执行子态：debug 轮产出 opinions.json 即进入联审产出面，融合后回 test）。
export type FlagState = 'debug' | 'test' | 'prod' | 'joint_review';

/** P4 六边状态机（纯函数·可测·零副作用；接线面最小侵入——骨架期零行为变化）。 */
export interface FlagSignals {
  /** DP-027 ⓐ（CTO 裁 2026-11-23）：双对象均值——E1/E2/E5 判据统一双信号；
   *  grade 源=computeJointGrade（DP-021 单一源·调用面传入·勿另算）。缺任一=无信号不转移。 */
  avgA?: number | null;
  avgB?: number | null;
  /** 展示面保留（**单 side 已废止**·不作 flag 边输入——CTO DP-027） */
  average?: number | null;
  /** 自上次 flag 切换起的轮数（E2 的 8 轮判定域） */
  roundsSinceFlag?: number | null;
  /** debug 轮 opinions 已产出且融合确认（E3 人机环信号·批准权层随 CTO 对齐） */
  opinionsFused?: boolean;
}

export interface FlagEdge {
  from: FlagState;
  to: FlagState;
  auto: boolean;                            // true=程序自动边 / false=人机环边（CEO/COS 批准）
  edge: 'E1_prod_low' | 'E2_test_stuck' | 'E3_debug_back' | 'E4_manual' | 'E5_test_high' | 'E6_sunday';
  reason: string;
}

/**
 * 六边转换判定（CTO 卷 §三）：
 *  E1 prod ≤95 → test（自动回退）  E2 test 8 轮未回 >95 → debug（自动）
 *  E3 debug 联审融合 → test（人机环）  E4 CEO/COS 手动 → test（setFlag 面·本函数不算）
 *  E5 test >95 → prod（自动·既有 EXIT_GATE 边保留）  E6 prod 周日迁移（cron 面·非本函数域）
 * 骨架期：本函数只判读不执行（runLoop 接线=log 面·flag 写面仍走 setFlag fail-closed）。
 */
export function nextFlagEdge(current: FlagState, s: FlagSignals): FlagEdge | null {
  // DP-027 ⓐ：双对象均值（单 side aggregate.average 已废止·不再作判据）
  const avgA = s.avgA ?? null;
  const avgB = s.avgB ?? null;
  const bothLow = avgA !== null && avgB !== null && avgA <= EXIT_GATE && avgB <= EXIT_GATE;
  const bothHigh = avgA !== null && avgB !== null && avgA > EXIT_GATE && avgB > EXIT_GATE;
  if (current === 'prod' && bothLow) {
    return { from: 'prod', to: 'test', auto: true, edge: 'E1_prod_low',
      reason: `prod dual-avg (a=${avgA}, b=${avgB}) both <= ${EXIT_GATE} -> auto fallback to test` };
  }
  if (current === 'test' && bothLow && (s.roundsSinceFlag ?? 0) >= 8) {
    return { from: 'test', to: 'debug', auto: true, edge: 'E2_test_stuck',
      reason: `test dual-avg both <= ${EXIT_GATE} for ${s.roundsSinceFlag} rounds >= 8 -> debug (7-seat joint review)` };
  }
  if (current === 'debug' && s.opinionsFused) {
    return { from: 'debug', to: 'test', auto: false, edge: 'E3_debug_back',
      reason: 'debug opinions fused (human-loop) -> back to test' };
  }
  if (current === 'test' && bothHigh) {
    return { from: 'test', to: 'prod', auto: true, edge: 'E5_test_high',
      reason: `test dual-avg (a=${avgA}, b=${avgB}) both > ${EXIT_GATE} -> prod (existing EXIT_GATE edge)` };
  }
  return null;
}

/**
 * P4 批准权分配（CEO④ 勘正形·CTO 对齐结论 2026-11-21）：`charter_approval` 字段按态分配——
 * debug 态任务书=CEO 批 / test+prod 态=COS 代批（approver 枚举 CEO|COS）。
 * 自动拾取链启用：**直接启用（CEO 决议戊 2026-11-21）**——旧口径「P6 收口后」已作废（CTO 勘正）。
 */
export function flagApprovalOwner(edge: FlagEdge): 'CEO' | 'COS' {
  return edge.to === 'debug' || edge.edge === 'E3_debug_back' ? 'CEO' : 'COS';
}

/** flag.json 卷面（D1 §二·切换权=CEO 令 authority_ref fail-closed 无 ref=拒绝） */
export interface FlagVolume {
  flag: FlagState;
  authority_ref?: string | null;           // 手动切换必载·EXIT≥95 程序边 ref=run
  switched_at?: string | null;
}

/** runner 状态卷面（round-queue/state/runner-state.json） */
export interface RunnerState {
  // A 件（CTO 设计稿 99d8c1343 §一·CEO 批 2026-11-24）：round_count=累计运行轮次（统计域·永不重置·含 debug/resume）·不再做 FUSE 判据；
  // FUSE 判据改 test_consecutive_rounds（test 态连续进化计数·退出/回 test 与点火新窗清 0）。
  round_count: number;                     // 累计运行轮次（统计域·永不重置）
  /** A 件：test 态连续进化计数（FUSE 判据域·缺省 0） */
  test_consecutive_rounds?: number;
  // ── #16 / DP-20261123-009 runId 贯穿 round 层（CTO 技术形卷 e9fb4dddc §三.1·2026-11-23）──
  // runId 根=COS 签发（launcher 外部注入式）·链层已有·本字段补轮层持久化（恢复锚/回执归属/trend 关联）。
  run_id?: string | null;
  fuse_marker?: boolean;                   // 熔断停候 CEO（fuse.marker+pending 冻结）
  resume_stage?: number | null;            // 续跑边（pending-retry 轮→下轮 resumeStage=7）
  // ── P4 状态机载体扩展（CTO 7c389cac3 §三·状态载体=runner-state 扩展）──
  flag_state?: FlagState | null;           // 现态快照（真源=flag.json·本字段=轮历史侧写）
  flag_since_round?: number | null;        // 自上次 flag 切换起的轮序（E2 的 8 轮判定域）
  // P4 批准权载体（CTO 卷 be7afadff §二·CEO 决议戊）：任务书派生链的审批挂载面
  pending_charter_ref?: string | null;     // 待批任务书引用（派生任务书生成后挂载）
  // DP-014 守卫双修（CTO 规格 2026-11-23）：pending 所属 runId（跨 run 判重锚·旧 run 残留不挡新联审）
  charter_run_id?: string | null;
  /** DP-030（CTO 急修·一纸一轮）：裁决件消费戳 `<run_id>:<round_count>` */
  ruling_consumed_ref?: string | null;
  // charter_approval 值表登记（CTO 附注 2026-11-21·防枚举漂散·照 rubric_defect 先例）：
  //   null = 未派生（无待批任务书）· 'CEO'/'COS' = 待批态（属主名·钩子写入）
  //   'APPROVED_CEO'/'APPROVED_COS' = 已批态（挂载 choreography 后更新·拾取面可见）
  charter_approval?: 'CEO' | 'COS' | 'APPROVED_CEO' | 'APPROVED_COS' | null;
  round_history?: Array<{ round: number; average?: number | null; flag?: FlagState | null; at?: string }> | null;
}

/** 一轮链跑结果（chain runner 适配位·节 4 spawn 七席接装） */
export interface RunResult {
  ok: boolean;
  run_dir: string;
  aggregate: { average?: number; verdict?: 'loop_exit' | 'continue' | string };
  err?: string;
  /** charter 1/2/5（CTO spec）：段门拒绝时的段名（可诊断·stop-on-non-pass） */
  failed_stage?: string;
}

export interface ChainRunner {
  run(params: RoundParams, resumeStage: number | null): Promise<RunResult>;
}

export interface RoundParams {
  run_id: string;
  [k: string]: unknown;
}

/** D6 gate 接线出参面（activation_gate.py --checks-json 出参·白名单投影） */
export interface ActivationVerdict {
  ok: boolean;
  gate: 'ready' | 'blocked';
  unmet?: string[];
  first_round_pending?: { state: 'stop' | 'released'; authority_ref?: string | null; brief?: Record<string, unknown> } | null;
  switch_announce?: Record<string, unknown> | null;
}

export interface RoundRunnerIo {
  /** 状态卷根（round-queue/）——注入面（白盒 tmp 形·产线=TriRMC 仓根 round-queue/） */
  queueRoot: string;
  /** D6 gate 判读（子进程 CLI·TC 检出路径注入——产线=/srv/fleet/TriCompany·929 现位） */
  activationProbe?: (checks: Record<string, unknown>) => ActivationVerdict;
  /** 十段链 runner（注入面·节 4 spawn 七席接装） */
  chainRunner: ChainRunner;
  /** 时刻串现查面（D-47：调用面传现查原值·件内零推算零估读） */
  nowIso: () => string;
}

// ── 状态 IO（白名单投影形·D-46：零密值字段零原始卷 dump） ──────────────

export function readFlag(io: RoundRunnerIo): FlagVolume {
  const p = path.join(io.queueRoot, 'state', 'flag.json');
  // DP-038/T4（任务书 v2·CEO 批 2026-11-24）：缺省=**debug**（M3-v2 门控起点）——
  // 原「缺省=test 直进形」注释废（D1 §二缺省面修订）；历史 test 态语义冻结（resume9-12 不回改·文档注）
  if (!existsSync(p)) return { flag: 'debug' };
  const vol = JSON.parse(readFileSync(p, 'utf8')) as FlagVolume;
  // P4 四态域（CTO 7c389cac3 §三）：prod/test/debug/joint_review（joint_review=debug 执行子态）
  if (vol.flag !== 'debug' && vol.flag !== 'test' && vol.flag !== 'prod' && vol.flag !== 'joint_review') {
    throw new Error(`flag.json flag 值出四态域: ${String(vol.flag)}`);
  }
  return vol;
}

/** DP-038/T4 ②：首轮 state 建立**显式写** flag.json(debug)（不依赖 readFlag 缺省直进）——
 *  缺文件才写=迁移兼容（③旧 state/queue 无 flag→补 debug 缺省·既有 state 零改）。 */
export function ensureFlagInit(io: RoundRunnerIo): void {
  const p = path.join(io.queueRoot, 'state', 'flag.json');
  if (existsSync(p)) return;
  const dir = path.join(io.queueRoot, 'state');
  mkdirSync(dir, { recursive: true });
  const vol: FlagVolume = { flag: 'debug', authority_ref: 'init:default-debug (DP-038/T4)',
                            switched_at: io.nowIso() };
  writeFileSync(p, JSON.stringify(vol, null, 2) + String.fromCharCode(10), 'utf8');
}

/** set_flag（D1 §二：手动切换必载 authority_ref 无 ref=拒绝 fail-closed·EXIT≥95 程序边=唯一自动写面） */
export function setFlag(io: RoundRunnerIo, flag: FlagState, authorityRef: string | null,
                        st?: RunnerState): void {
  if (authorityRef === null || !String(authorityRef).trim()) {
    throw new Error('set_flag 拒绝：authority_ref 必载（CEO 切换权 fail-closed·无 ref=拒绝）');
  }
  const dir = path.join(io.queueRoot, 'state');
  mkdirSync(dir, { recursive: true });
  const vol: FlagVolume = { flag, authority_ref: String(authorityRef), switched_at: io.nowIso() };
  writeFileSync(path.join(dir, 'flag.json'), JSON.stringify(vol, null, 2) + '\n', 'utf8');
  // A 件 ③b/⑤（CTO 2026-11-24 补·DCA 首案）：转 test（E2 真路径）=新连续周期——清计数并持久化
  if (st && flag === 'test') {
    st.test_consecutive_rounds = 0;
    writeRunnerState(io, st);
  }
}

export function readRunnerState(io: RoundRunnerIo): RunnerState {
  const p = path.join(io.queueRoot, 'state', 'runner-state.json');
  if (!existsSync(p)) return { round_count: 0, resume_stage: null, run_id: null };
  return JSON.parse(readFileSync(p, 'utf8')) as RunnerState;
}

export function writeRunnerState(io: RoundRunnerIo, st: RunnerState): void {
  const dir = path.join(io.queueRoot, 'state');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'runner-state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8');
}

// ── D6 gate 接线（起跑前置检查位·子进程 CLI 调 TC 检出） ────────────────

export interface GateProbePaths {
  /** TC 检出根（产线=/srv/fleet/TriCompany·929 现位·河源 blob 全等已钉 D7 验证段） */
  triCompanyRoot: string;
  pythonBin?: string;                      // 缺省 python3
}

/**
 * check_activation 子进程 CLI 探（施工选定形候 CTO 终审注）。
 * 判据采集位=调用面（值席/runner 起跑前采集 A1-A4）——本面只喂入+读出参零判读。
 */
export function probeActivationGate(paths: GateProbePaths, checks: Record<string, unknown>): ActivationVerdict {
  const py = paths.pythonBin ?? 'python3';
  const gateScript = path.join(paths.triCompanyRoot, 'runtime', 'cognition', 'activation_gate.py');
  const out = execFileSync(py, [gateScript, '--checks-json', JSON.stringify(checks)], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return JSON.parse(out) as ActivationVerdict;
}

// ── loop 引擎本体（D1 §一 while 体照铸） ──────────────────────────────

export interface LoopExitReason {
  kind: 'prod' | 'fuse' | 'failed' | 'first_round_pending';
  detail: string;                          // 白名单投影面（D-46：零密值零原始 payload dump）
}

export interface LoopOutcome {
  exit: LoopExitReason | null;             // null=非终出局（保留扩展）
  rounds_run: number;
  final_state: RunnerState;
  /** DP-037/T5（任务书 v2）：已尝试轮数（含未完成即失败的当前轮）——上报面区分 rounds_run */
  rounds_started: number;
}

/**
 * loop 引擎宿主（D1 §一主形）：点火后单进程自主迭代——
 * 状态机四支（225 款二）：debug=体内候裁决／test=直进／EXIT≥95=break+flag→prod／8 轮 FUSE=break 熔断。
 * prod 不入本循环（点火面拦截→单轮直走形·调用面守）。
 */
export async function runLoop(io: RoundRunnerIo, ignite: { params: RoundParams; checks?: Record<string, unknown> }): Promise<LoopOutcome> {
  ensureFlagInit(io);   // DP-038/T4 ②：初始化断言（首轮显式写 debug·缺省不再承担直进面）
  const flagVol = readFlag(io);
  if (flagVol.flag === 'prod') {
    throw new Error('prod 不入 loop（点火面拦截→单轮直走形·D1 §一 prod 分支）');
  }
  const st = readRunnerState(io);
  let rounds = 0;
  let roundsStarted = 0;   // DP-037/T5：尝试轮计数（轮首+1·失败轮计入·上报面）
  let params = ignite.params;
  // #16（DP-009·CTO e9fb4dddc）：链层 runId 注入轮态（老 state 无此字段=宽容补写·随既有 writeRunnerState 落盘）
  st.run_id = (params.run_id as string | undefined) ?? null;
  // A 件 ③b：点火新窗——flag≠test 清连续计数并持久化（test 窗保留续算·E2/E3 转换后已清）
  if (readFlag(io).flag !== 'test') {
    if ((st.test_consecutive_rounds ?? 0) !== 0) {
      st.test_consecutive_rounds = 0;
      writeRunnerState(io, st);   // 清写持久化（否则终态读回暖态）
    }
  }

  // 起跑前置检查位（D6 gate 接线·gate=ready 方可入轮——D7 验证段四锚承录）
  // A1-A4 状态采集喂入：采集位=调用面（值席起跑前采集）·runner 只透传零判读（勘面卷 §三.4 承）
  let gateVerdict: ActivationVerdict | null = null;
  if (io.activationProbe) {
    const v = io.activationProbe(ignite.checks ?? {});
    if (!v.ok || v.gate !== 'ready') {
      return {
        exit: { kind: 'failed', detail: `activation gate blocked（unmet=${(v.unmet ?? []).join(',')}）——起跑门闭 fail-closed` },
        rounds_run: 0,
        final_state: st,
      };
    }
    gateVerdict = v;
  }

  // 首轮知情停点消费面（resume_stage 续跑边·pending-retry 轮下轮=--resume-stage 7 形）
  const resumeStage = st.resume_stage ?? null;

  for (;;) { // while True（D1 §一）
    roundsStarted += 1;   // DP-037/T5：每轮尝试即计
    const run = await io.chainRunner.run(params, resumeStage);   // 十段链+Skill 段程序化 spawn（节 4 接装）
    if (!run.ok) {                                               // 款三纪律：段报错停 fail-closed
      return { exit: { kind: 'failed', detail: `run failed: ${run.err ?? 'unknown'}` }, rounds_run: rounds, rounds_started: roundsStarted, final_state: st };
    }
    const verdict = run.aggregate.verdict;
    // ── v7 轮末钩（CTO ce26401a9·loop 层）：十段全毕 → 七席联审（两对象）→opinions→生成器→pending ──
    await runJointReviewHook(io, st, params);
    if (verdict === 'loop_exit') {                               // 联审均分≥95（≥95 含边界）
      st.test_consecutive_rounds = 0;   // A 件 ③b：退出 test 清连续计数
      setFlag(io, 'prod', `run:${run.run_dir}`);                 // 唯一程序自动边（EXIT2·sanctioned）
      return { exit: { kind: 'prod', detail: `EXIT>=${EXIT_GATE}→prod（ref=${run.run_dir}）` }, rounds_run: rounds, rounds_started: roundsStarted, final_state: st };
    }
    // DP-027 ⓑ（CTO 裁）：M9 FUSE 按态收窄——仅 test 态熔断；debug 不熔断（审批步 M4-v2 节流为界·如实注）；prod 不入 loop（起跑拦截既有）
    if (flagVol.flag === 'test' && (st.test_consecutive_rounds ?? 0) >= FUSE_MAX_ROUNDS) {   // ①8 轮 FUSE（7→8 边界=F-2 钉）
      st.fuse_marker = true;
      writeRunnerState(io, st);                                  // 熔断停候 CEO（fuse.marker+pending 冻结）
      return { exit: { kind: 'fuse', detail: `FUSE 熔断（round_count=${st.round_count}>=${FUSE_MAX_ROUNDS}）候 CEO` }, rounds_run: rounds, rounds_started: roundsStarted, final_state: st };
    }
    // 首轮毕知情停点消费（勘面卷 §三.4 执行面：停面+呈报+候令 loop 体域随铸·preflight 节 3）
    // 放行令=令面非时面：authority_ref 在=released·无 ref=拒绝 fail-closed——放行一次非逐轮（gateVerdict 仅首轮毕查）
    if (rounds === 0 && gateVerdict?.first_round_pending) {
      const frp = gateVerdict.first_round_pending;
      const released = frp.state === 'released' && !!(frp.authority_ref && String(frp.authority_ref).trim());
      if (!released) {
        // 呈报载荷出链=白名单投影（D-46）：大白话一行+停面态声明·零原始 brief dump
        const plainLine = frp.brief && typeof frp.brief['plain_line'] === 'string' ? String(frp.brief['plain_line']) : '';
        return {
          exit: {
            kind: 'first_round_pending',
            detail: `首轮毕知情停点（state=${frp.state}·authority_ref=${frp.authority_ref ? '在' : '缺'}）——停面候 CEO 知情放行${plainLine ? `｜${plainLine}` : ''}`,
          },
          rounds_run: rounds,
          final_state: st,
        };
      }
      // released → 放行落下迭代（放行一次非逐轮·后续轮零复查 gateVerdict）
    }
    if (flagVol.flag === 'debug') {                              // 体内候裁决事件（notice-202 门=事件源单值）
      // P4 tie 位移（CTO ce26401a9 v7）：生成器链上移轮末钩（runJointReviewHook 内），本块仅裁决事件。
      const ruling = await awaitCeoRuling(io, st, params);                   // continue/terminate/absent 三态
      if (ruling === 'terminate') {
        return { exit: { kind: 'failed', detail: 'CEO ruling=terminate' }, rounds_run: rounds, rounds_started: roundsStarted, final_state: st };
      }
      if (ruling === 'absent') {
        return { exit: null, rounds_run: rounds, rounds_started: roundsStarted, final_state: st }; // 挂起（不迭代·fail-closed·候裁决投递）
      }
      // continue=批准 → 挂载 choreography（CTO 裁：批准后挂树·发布行为·拾取面可见）
      await tryCharterMount(io, st, params);
      // 落下迭代
    } // test=直进下轮迭代（不候裁决）
    // 铸件族窗 clear-write 修形（CTO 裁·2026-11-22 A 部署）：resume 轮毕清写——防放行态下二次点火
    // 陈旧 resume_stage 静默跳段（三形态实锤：continue 轮毕不清→同段重复→FUSE）。写前清=fail-safe 形。
    st.resume_stage = null;
    if (flagVol.flag === 'test') {   // A 件 ③a：test 态每轮完成连续计数 +1
      st.test_consecutive_rounds = (st.test_consecutive_rounds ?? 0) + 1;
    }
    st.round_count += 1;
    writeRunnerState(io, st);
    rounds += 1;
    params = nextRoundParams(st, params);                        // 自主迭代推进（非外部队列接力·款一勘正主形）
  }
}

/** @internal v7 loop 尾段七席联审轮末钩（CEO 任务书 v7·CTO ce26401a9 定形·loop 层非 fade 段）：
 *  十段全毕（run.ok）后发起七席联审（两对象×各席≥3 部门维度）→opinions.json（schema 2.0.0·
 *  improvements 五字段）→ 生成器 → 任务书 → pending_charter_ref 写（与 P4 钩子同链）。
 *  env LOOP_JOINT_REVIEW=0 可关（回滚锚）；fail-closed：联审败=state 不动+stderr 留痕；幂等：已有待批不重复。 */
/** DP-20261123-021（CTO 规格·CEO 令准）：联审 grade 判定（单一源）——
 *  A/B = mean-of-seat-means（优先取 joint-review.seat_means·缺则由 faces 现算，聚合口径不变）；
 *  门槛：debug 态 A>90 且 B>90 = bothPass（达标轮不生成 charter）。 */
export interface JointGrade { a: number | null; b: number | null; bothPass: boolean; }
export const JOINT_GRADE_THRESHOLD = 90;

export function computeJointGrade(jr: unknown): JointGrade {
  const doc = (jr ?? {}) as { seat_means?: { a?: number | null; b?: number | null }; faces?: Record<string, unknown> };
  let a: number | null = doc.seat_means?.a ?? null;
  let b: number | null = doc.seat_means?.b ?? null;
  if ((a === null || b === null) && doc.faces) {
    const as: number[] = []; const bs: number[] = [];
    for (const f of Object.values(doc.faces)) {
      const face = (f ?? {}) as { absent?: boolean; dimensions?: Array<{ object?: string; score?: number }> };
      if (face.absent) continue;
      const da = (face.dimensions ?? []).filter((x) => x?.object === 'a' && typeof x?.score === 'number').map((x) => x.score as number);
      const db = (face.dimensions ?? []).filter((x) => x?.object === 'b' && typeof x?.score === 'number').map((x) => x.score as number);
      if (da.length) as.push(da.reduce((s, v) => s + v, 0) / da.length);
      if (db.length) bs.push(db.reduce((s, v) => s + v, 0) / db.length);
    }
    if (a === null && as.length) a = Math.round((as.reduce((s, v) => s + v, 0) / as.length) * 100) / 100;
    if (b === null && bs.length) b = Math.round((bs.reduce((s, v) => s + v, 0) / bs.length) * 100) / 100;
  }
  const bothPass = a !== null && b !== null && a > JOINT_GRADE_THRESHOLD && b > JOINT_GRADE_THRESHOLD;
  return { a, b, bothPass };
}

export async function runJointReviewHook(io: RoundRunnerIo, st: RunnerState, params: RoundParams): Promise<{ grade: JointGrade; charter: 'skipped' | 'attempted' } | void> {
  if (process.env.LOOP_JOINT_REVIEW === '0') return;
  const runDir = typeof params.runDir === 'string' ? params.runDir : '';
  if (!runDir) return;
  // DP-014 守卫双修（CTO 规格·2026-11-23）：①approved 态不挡——已批/mount 后跨 run 放行新联审；
  // ②pending 仅当属**本 run**（charter_run_id===params.run_id）才短路（幂等）——旧 run 残留 pending 不挡。
  const _approved = st.charter_approval === 'APPROVED_CEO' || st.charter_approval === 'APPROVED_COS';
  if (!_approved && st.pending_charter_ref && st.charter_run_id === params.run_id) return;   // 幂等（本 run）
  const cogDir = process.env.TRICO_COGNITION_DIR ?? '/srv/fleet/TriCompany/runtime/cognition';
  const script = path.join(cogDir, 'loop_joint_review_spawn.py');
  if (!existsSync(script)) { console.error('[fade001:joint-review] script missing (fail-closed): ' + script); return; }
  const py = process.env.FADE_PYTHON ?? 'python3';
  // DP-20261123-014（CTO 规格·DP-012 同族）：hook spawn 子进程 env/cwd 自足——
  // 联审七席 spawn 不再依赖调用方 env（ModuleNotFoundError 面修·cwd=TC 检出根·PYTHONPATH append）。
  const _tcRoot = path.dirname(path.dirname(cogDir));
  const r = spawnSync(py, [script, '--run-dir', runDir, '--run-id', String(params.run_id ?? '')], {
    encoding: 'utf8',
    timeout: SPAWN_STAGE_TIMEOUT_MS,
    cwd: _tcRoot,
    env: { ...process.env, PYTHONPATH: appendPyPath(process.env.PYTHONPATH, _tcRoot) },
  });
  if (r.status !== 0) {
    console.error('[fade001:joint-review] spawn rc=' + String(r.status) + ' (fail-closed): ' + String((r.stderr ?? '').slice(-200)));
    return;
  }
  // ── 阶段1 完成：读联审卷→grade（A/B 聚合口径不变·单一源 computeJointGrade）──
  let grade: JointGrade = { a: null, b: null, bothPass: false };
  try {
    const jr = JSON.parse(readFileSync(path.join(runDir, 'joint-review.json'), 'utf8'));
    grade = computeJointGrade(jr);
  } catch (e) {
    console.error('[fade001:joint-review] joint-review.json unreadable（grade unknown·按未达标走 charter 链）: '
      + (e instanceof Error ? e.message : String(e)));
  }
  // ── 阶段2：条件 charter（DP-021·CTO 裁）——达标轮 skip 留痕；未达标轮照现生成器链 ──
  if (grade.bothPass) {
    try {
      writeFileSync(path.join(runDir, 'charter-skip.json'),
        JSON.stringify({ reason: 'A/B passed', gate: `a>${JOINT_GRADE_THRESHOLD} && b>${JOINT_GRADE_THRESHOLD}`, grade }, null, 2) + String.fromCharCode(10), 'utf8');
    } catch { /* 留痕面零阻断 */ }
    console.error(`[fade001:charter-hook] skipped: A/B passed (a=${String(grade.a)}, b=${String(grade.b)})`);
    return { grade, charter: 'skipped' as const };
  }
  await tryCharterHook(io, st, params);   // opinions.json → 生成器 → pending 写（P4 tie 位移后同链复用）
  return { grade, charter: 'attempted' as const };
}

/** @internal P4 接线件（COO 派工 2026-11-21）：debug 联审毕→生成器调用钩子（COS 契约冻结面）。
 *  本钩子=debug 态专用·approver 恒 CEO（CTO 终审附注）；若将来多态复用→改走 flagApprovalOwner 派生。
 *  幂等：pending_charter_ref 已在=不重复生成；fail-closed：生成器拒/异常=state 不动，stderr 如实留痕。 */
export async function tryCharterHook(io: RoundRunnerIo, st: RunnerState, params: RoundParams): Promise<void> {
  const runDir = typeof params.runDir === 'string' ? params.runDir : '';
  if (!runDir) return;
  const opinionsPath = path.join(runDir, 'opinions.json');
  if (!existsSync(opinionsPath)) return;                        // 联审未产=零行为（no-op）
  // DP-014 守卫双修同判形：approved 不挡·pending 属本 run 才短路
  const _ap = st.charter_approval === 'APPROVED_CEO' || st.charter_approval === 'APPROVED_COS';
  if (!_ap && st.pending_charter_ref && st.charter_run_id === params.run_id) return;   // 幂等：本 run 已挂待批不重复
  try {
    const mod = await import('./charter_generator.js');
    const res = mod.generateCharterFromFile(opinionsPath, { approver: 'CEO' });  // debug 链=CEO 批（CEO④ 形）
    if (!res.ok || !res.charter) {
      console.error(`[fade001:charter-hook] generator rejected（fail-closed 不写 pending）: ${res.reason ?? 'unknown'}`);
      return;
    }
    const stamp = io.nowIso().replace(/[-:.]/g, '');
    const charterPath = path.join(runDir, `charter-${stamp}.json`);
    writeFileSync(charterPath, JSON.stringify(res.charter, null, 2) + '\n', 'utf8');
    st.pending_charter_ref = charterPath;
    st.charter_approval = 'CEO';
    st.charter_run_id = (params.run_id as string | undefined) ?? null;   // DP-014：判重锚=本 run
    writeRunnerState(io, st);
  } catch (e) {
    console.error(`[fade001:charter-hook] generator unavailable（fail-closed）: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** @internal P4 挂载 choreography（CTO 裁 2026-11-21·第三形）：CEO 批准后任务书挂
 *  trees/<week>/trees/fade001-evolve-<ts>/（复制形·拾取面扫描要实体）。链序=生成→CEO 批→挂载→拾取
 *  （挂树=发布行为·未批不发布）；三形照役：fail-closed（失败=state 不动+stderr）/幂等（APPROVED_* 不重复）/
 *  树规范（operating-records 周目录·禁仓库根）。 */
export async function tryCharterMount(io: RoundRunnerIo, st: RunnerState, params: RoundParams): Promise<void> {
  if (!st.pending_charter_ref || !existsSync(st.pending_charter_ref)) return;
  if (st.charter_approval === 'APPROVED_CEO' || st.charter_approval === 'APPROVED_COS') return;  // 幂等
  const tmvRoot = typeof params.tmvRoot === 'string' ? params.tmvRoot : '';
  const week = typeof params.fromWeek === 'string' ? params.fromWeek : '';
  if (!tmvRoot || !week) { console.error('[fade001:charter-mount] tmvRoot/fromWeek missing (fail-closed)'); return; }
  const stamp = io.nowIso().replace(/[-:.]/g, '');
  const dir = path.join(tmvRoot, 'docs', 'workflow', 'operating-records', week, 'trees', `fade001-evolve-${stamp}`);
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(st.pending_charter_ref, path.join(dir, path.basename(st.pending_charter_ref)));
    st.charter_approval = st.charter_approval === 'COS' ? 'APPROVED_COS' : 'APPROVED_CEO';
    writeRunnerState(io, st);
  } catch (e) {
    console.error(`[fade001:charter-mount] mount failed (fail-closed): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** CEO 裁决事件源（round-queue/state/ceo-ruling.json 落卷=体内 await 事件源·>72h 升级催办挂起保持） */
async function awaitCeoRuling(io: RoundRunnerIo, st: RunnerState, params: RoundParams): Promise<'continue' | 'terminate' | 'absent'> {
  const p = path.join(io.queueRoot, 'state', 'ceo-ruling.json');
  if (!existsSync(p)) return 'absent';
  let vol: { ruling?: string; run_id?: string; round_count?: number; signed_at?: string };
  try {
    vol = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return 'absent';
  }
  // DP-030 防御面（CTO 急修·与 preflight check_ceo_ruling 同构）：
  // ①三绑：run_id 匹配本 run + round_count 必带 + signed_at；⑤旧件缺键=absent 不认（旧 continue 作废需重签）
  const rid = String(params.run_id ?? '');
  if (!vol?.run_id || vol.round_count === undefined || !vol.signed_at) {
    console.error('[fade001:ceo-ruling] rejected: legacy file missing run_id/round_count/signed_at (DP-030)');
    return 'absent';
  }
  if (String(vol.run_id) !== rid) {
    console.error(`[fade001:ceo-ruling] rejected: cross-run file run_id=${String(vol.run_id)} != ${rid} (DP-030)`);
    return 'absent';
  }
  // ②一纸一轮：消费戳比对
  const ref = `${vol.run_id}:${vol.round_count}`;
  if (st.ruling_consumed_ref === ref) {
    console.error(`[fade001:ceo-ruling] rejected: already consumed ${ref} (DP-030)`);
    return 'absent';
  }
  // CTO 2026-11-23 键名 drift 修：同工件两键名（preflight 读 decision / 本面旧读 ruling）——decision 主·ruling 兼容
  const decision = String((vol as { decision?: string }).decision ?? vol.ruling ?? '').toLowerCase();
  if (decision === 'continue') {
    st.ruling_consumed_ref = ref;   // ③消费即写戳（下一轮不可复用）
    writeRunnerState(io, st);
    return 'continue';
  }
  if (decision === 'terminate') return 'terminate';
  return 'absent';
}

/** 轮间参数推进（自主迭代·白名单投影零密值） */
function nextRoundParams(st: RunnerState, prev: RoundParams): RoundParams {
  return { ...prev, round: (typeof prev.round === 'number' ? prev.round : 0) + 1, round_count: st.round_count };
}
