// ── FADE-001 D7 节 4·chain_runner（十段链段序驱动器·spawn 七席通道接装） ──
// D1 卷 §四装配正形照铸：「Skill 段脚本化 spawn＋段 N+1 前置断言=段 N 落卷真值（硬串行
// 禁跳段）＋装配=程序面 agent 只判读＋产出回管道落卷」——本件承载=段序驱动+产物真值
// 前置断言+rc_guard fail-closed+aggregate 白名单投影·零复刻各段 CLI 内部判读（三层判据
// 族分野同 round_runner 形·gate/门判读零夹带）。
//
// 承载位选定形如实注（候 CTO 终审注·gate CLI 先例形 preflight §一）：payload vB→十阶段
// 形 PATCH=周日首拍前置授权窗（dce_steps.py 头注承·本树零调用实勘 2026-11-21 find 零
// 命中）——段序驱动承载位=本件 TS 面（子进程逐段调 TC runtime/cognition/ CLI 现役形），
// 非重铸编排非替身段——CLI 本体零触零改。
//
// spawn 七席通道接装（COO 节 4 令面①）：段 7=score_skill_spawn.py 现役正形（dsh headless
// CLI·7 席 spawn·score_skill_spawn.py _spawn_seat 承）——本件子进程调它=spawn 通道接装
// 面·零另铸替身（D-27 承录：spawn 形定谳=dsh CLI 现役先例）。
//
// verdict 投影面（轮转边数值判读·loop 引擎 L194「联审均分≥95」消费域）：
//   cos-score.json 在（D4 §一轮毕意见窗产物·真值源）→ joint_review_avg_score 数值面——
//   ≥95（含边界）→ verdict='loop_exit'（EXIT2 sanctioned·唯一程序自动边）／<95 → 'continue'；
//   eviction_decision（evolve|hold 二值）零消费=层 2 门域（cos_decision_gate/preflight
//   轮间门消费·三层判据族分野——runner 零复刻 gate 判读）。
//   cos-score.json 缺（首轮·意见窗未开）→ manifest.json run 终态投影：ok→'continue'（轮
//   毕候意见窗）/failed|stale→ok=false+err（款三 fail-closed）。
//
// 四护栏常位承录（同 round_runner）：
//   ②GLM 轨单跑纪律面=同窗并发 1（本件串行 for·零并发段）；
//   ③D-46=err 投影白名单形（段名+rc+stderr 尾行截断·零原始 stdout/stderr dump）；
//   ④D-47=件内零时刻推算零拼接（卷面值自持·nowIso 不入本件域）；
//   resume 轮间指令面（D1 §六A·D5 拟稿 schema 承「--resume-stage 7 形」）=本件承载：
//   resumeStage=N（score 段=7）→ 从段 N 起跑+段 1..N-1 产物真值前置断言全在（缺=fail
//   fail-closed 零静默跳段）。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ChainRunner, RoundParams, RunResult } from './round_runner.js';

/** 段特有参数面（白名单构造 argv 用·零瞎传） */
/** charter 1/2/5（CTO spec d8582717f·CEO 批 2026-11-24）：段门语义统一——
 *  每段毕统一判「pass→续／非 pass→止链+不 notify」；判定=单一实现点。
 *  回退锚：env FADE_CHAIN_GATE_STRICT=0 回旧形（rc-only）。 */
export const chainGateStrict = (): boolean => process.env.FADE_CHAIN_GATE_STRICT !== '0';   // 动态读（回退锚 FADE_CHAIN_GATE_STRICT=0）

export interface StageGateResult { ok: boolean; detail: string; verdict?: string; }

/** 段输出门：读段产物 JSON·含 verdict 键则 pass 才过（dce/verify/score/plan 等）；
 *  无产物/无 verdict 键=门 skip（ok）。 */
export function gateStageResult(stage: { name: string; output: string }, runDir: string): StageGateResult {
  const p = path.join(runDir, stage.output);
  if (!existsSync(p)) return { ok: true, detail: 'no output (gate skip)' };
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (!doc || typeof doc !== 'object') {
      return { ok: true, detail: 'non-object (gate skip)' };
    }
    // c3 双修 B（CTO 令 2026-11-24）：inner score.verdict 优先（score.json=score 段嵌套形）·旧件兼容回落顶层
    const inner = (doc.score && typeof doc.score === 'object' && 'verdict' in (doc.score as Record<string, unknown>))
      ? (doc.score as Record<string, unknown>).verdict : undefined;
    if (inner === undefined && !('verdict' in doc)) {
      return { ok: true, detail: 'no verdict key (gate skip)' };
    }
    const v = String(inner ?? doc.verdict);
    return { ok: v === 'pass', detail: `verdict=${v}${inner !== undefined ? ' (inner)' : ''}`, verdict: v };
  } catch {
    return { ok: true, detail: 'unparsable (gate skip·解析面归 parse 加固件)' };
  }
}

export interface ChainParams {
  runDir: string;          // run 目录（产物落卷位·调用面铸形）
  runId: string;
  fromWeek: string;
  toWeek: string;
  startDate: string;       // 新周起始日 YYYY-MM-DD（preflight required·dce 透传）
  tmvRoot: string;         // TriMetaverse 工作区根（dce required）
  queueRoot?: string;      // DP-038/T4：flag 门断言读面（preflight --queue-root）
}

export interface ChainRunnerPaths {
  triCompanyRoot: string;  // TC 检出根（产线=/srv/fleet/TriCompany·929 现位）
  pythonBin?: string;      // 缺省 python3
  stageTimeoutMs?: number; // 每段超时（缺省 900_000·与 score skill spawn 上限对表）
}

interface StageDef {
  name: string;
  script: string;          // TC runtime/cognition/ 相对路径
  output: string;          // 产物卷名（run_dir 内·前置断言域）
  /** stdout JSON 重定向族（preflight/qualify=CLI 打 stdout·本件落卷） */
  redirect?: boolean;
  /** 段级超时覆写（段 7 spawn 窗对表随行项·COO 节 4 释放令条款③勘定面） */
  timeoutMs?: number;
  argv: (p: ChainParams, runDir: string) => string[];
}

/**
 * spawn 段总窗对表（COO 释放令条款③随行项落实形）：score_skill_spawn 每席 subprocess
 * timeout 缺省 900s·7 席串行→段总窗上限=7×900s+开销余量≈6_600_000ms（110min）——
 * 默认段超时 900s 会截杀 spawn 段（真发前必修面·2026-11-21 勘定）。
 */
export const SPAWN_STAGE_TIMEOUT_MS = 7_200_000;

// ── P3 灰度形（CTO 定谳 7c389cac3 §一·2026-11-21）：段 3/段 8 spawn cos 化切换 ──
// env FADE_PLAN_SPAWN=1 / FADE_CLOSE_SPAWN=1 → spawn 形；缺省=CLI 形（现役·零行为变化）。
// 回滚=去 env 即回 CLI 形（双形并存·灰度首用）。
// CEO 任务书 v7 flip（2026-11-22）：段 3/8 spawn 化=默认正形（P3 接线毕）；env ='0' 可关回 CLI 形（回滚锚）。
const PLAN_SPAWN = process.env.FADE_PLAN_SPAWN !== '0';
const CLOSE_SPAWN = process.env.FADE_CLOSE_SPAWN !== '0';

/** 十段链段序表（硬串行·禁跳段——D1 §四；argv=各段 argparse 必载面白名单·2026-11-21 现役勘定） */
export const STAGES: StageDef[] = [
  {
    name: 'preflight', script: 'preflight.py', output: 'preflight.json', redirect: true,
    // DP-030：传 run-dir 供 preflight prev 解析显式排除自身（argv 与 parser 同 commit 原子落）
    // DP-031 ②：点火形显式传 --prev-runs-root（run-dir 父=轮仓根·防根缺静默 skip 蒸发门面）
    argv: (p) => ['--from', p.fromWeek, '--to', p.toWeek, '--start-date', p.startDate,
      '--run-dir', p.runDir, '--prev-runs-root', path.dirname(p.runDir),
      '--queue-root', p.queueRoot ?? ''],
  },
  {
    name: 'qualify', script: 'qualify.py', output: 'qualify.json', redirect: true,
    argv: (p) => ['--run-dir', p.runDir],
  },
  {
    name: 'plan_scope',
    script: PLAN_SPAWN ? 'plan_skill_spawn.py' : 'plan_scope.py',
    output: 'plan.json',
    // DP-20261123-019→COO 2026-11-23 16:43 第三调：段 3 预算 900→300→**480s**（300 太紧 38 步未毕/900 太宽过载/480 余量仍快）
    timeoutMs: 480_000,
    // CLI 形：--operating-root 必传绝对形（CLI 缺省=相对 cwd 解析·第八发实锚 2026-11-21）+
    // --start-date（周目录年段推算第一候选分支入参·零传=fallthrough 面）
    // spawn 形（P3 灰度）：单席 cos 产出 plan.json·argv 仅 run 面（schema 校验在脚本内 fail-closed）
    argv: PLAN_SPAWN
      // DP-020 追补 c：传段预算（300s）——脚本内子 spawn 超时=min(spawn_timeout, 段剩余)
      ? (p) => ['--run-dir', p.runDir, '--run-id', p.runId, '--from-week', p.fromWeek, '--to-week', p.toWeek, '--stage-budget', '480', '--tmv-root', p.tmvRoot]
      : (p) => ['--from-week', p.fromWeek, '--to-week', p.toWeek, '--run-dir', p.runDir, '--run-id', p.runId,
        '--operating-root', path.join(p.tmvRoot, 'docs/workflow/operating-records'), '--start-date', p.startDate],
  },
  {
    name: 'dce', script: 'dce_steps.py', output: 'dce.json',
    // dce 执行开关（CEO 2026-11-24 17:5x 批「dce 开关和授权窗都开」）：DCE_EXECUTE=1 才真跑·
    // 默认 dry_run 保持（安全；dry_run 面 verdict=dry_run_not_executed → 段门拒止链）。
    // A 案（CTO 2026-11-24 18:09·CEO 批）：补 --start-date/--operating-root（与 verify 段同形·
    // 缺之=migrate cmd 渲染缺参 rc=2 根因）
    argv: (p) => ['--tmv-root', p.tmvRoot, '--plan-file', path.join(p.runDir, 'plan.json'),
      '--from-week', p.fromWeek, '--to-week', p.toWeek, '--run-dir', p.runDir, '--run-id', p.runId,
      '--start-date', p.startDate, '--operating-root', path.join(p.tmvRoot, 'docs/workflow/operating-records'),
      ...(process.env.DCE_EXECUTE === '1' ? ['--execute'] : [])],
  },
  {
    name: 'verify', script: 'verify.py', output: 'verify.json',
    // --operating-root/--start-date 同族必传（verify.py L272/L275 相对缺省同坑·第八发乘机扫毕预判 2026-11-21）
    // v8 item1：--strict 必填随行（verify 强制严格形·argv 与 parser 同 commit）
    argv: (p) => ['--plan-file', path.join(p.runDir, 'plan.json'), '--from-week', p.fromWeek,
      '--to-week', p.toWeek, '--run-dir', p.runDir, '--run-id', p.runId, '--strict',
      '--operating-root', path.join(p.tmvRoot, 'docs/workflow/operating-records'), '--start-date', p.startDate],
  },
  {
    name: 'score', script: 'score_cli.py', output: 'score.json',
    argv: (p) => ['--run-dir', p.runDir, '--run-id', p.runId, '--from-week', p.fromWeek, '--to-week', p.toWeek],
  },
  {
    name: 'score_skill', script: 'score_skill_spawn.py', output: 'score-skill.json',
    timeoutMs: SPAWN_STAGE_TIMEOUT_MS,                           // spawn 窗对表（7×900s+余量·随行项条款③）
    argv: (p) => ['--run-dir', p.runDir, '--run-id', p.runId],   // spawn 七席段（现役正形·dsh headless CLI）
  },
  {
    name: 'close_skill',
    // P3 灰度：spawn 形单席 cos 产出 close.json（upgrade_list_state 契约硬项校验在脚本内 fail-closed）·
    // argv 两形同面（run-dir/run-id/from-week/to-week）
    script: CLOSE_SPAWN ? 'close_skill_spawn.py' : 'close_skill.py',
    output: 'close.json',
    argv: (p) => ['--run-dir', p.runDir, '--run-id', p.runId, '--from-week', p.fromWeek, '--to-week', p.toWeek],
  },
  {
    name: 'close', script: 'close_cli.py', output: 'manifest.json',
    argv: (p) => ['--run-dir', p.runDir, '--run-id', p.runId, '--from-week', p.fromWeek, '--to-week', p.toWeek],
  },
  {
    name: 'notify_done', script: 'notify_done.py', output: 'notify_done.json',
    argv: (p) => ['--run-dir', p.runDir, '--run-id', p.runId, '--from-week', p.fromWeek, '--to-week', p.toWeek],
  },
];

/** err 投影尾行截断宽（D-46 白名单形·零原始 dump） */
const ERR_TAIL = 200;

/** stderr/stdout 尾行投影（D-46：段名+rc+尾行截断·零完整 dump 零密值承载） */
/** @internal DP-20261123-012（CTO 裁形·2026-11-23）：PYTHONPATH append 而非覆盖。
 *  spawn 面自足：cwd=TC 根 + PYTHONPATH 含 TC 根（parts 去重·跨平台 path.delimiter）。 */
export function appendPyPath(existing: string | undefined, dir: string): string {
  if (!existing || existing.trim() === '') return dir;
  const parts = existing.split(path.delimiter);
  return parts.includes(dir) ? existing : existing + path.delimiter + dir;
}

function tail(text: string): string {
  const t = text.trim();
  return t.length > ERR_TAIL ? `…${t.slice(-ERR_TAIL)}` : t;
}

/** verdict 投影（数值面 95 线程序边·EXIT_GATE 对表 round_runner） */
function projectVerdict(runDir: string): { ok: boolean; average?: number; verdict?: string; err?: string } {
  const cosP = path.join(runDir, 'cos-score.json');
  if (existsSync(cosP)) {
    const cos = JSON.parse(readFileSync(cosP, 'utf8')) as { joint_review_avg_score?: number };
    const avg = typeof cos.joint_review_avg_score === 'number' ? cos.joint_review_avg_score : undefined;
    if (avg === undefined) {
      return { ok: false, err: 'cos-score.json joint_review_avg_score 缺/非数值——verdict 投影零判读 fail-closed' };
    }
    // 95 线程序边（≥95 含边界·EXIT2 sanctioned）——eviction_decision 零消费（层 2 门域·零夹带）
    return { ok: true, average: avg, verdict: avg >= 95 ? 'loop_exit' : 'continue' };
  }
  const mfP = path.join(runDir, 'manifest.json');
  if (!existsSync(mfP)) {
    return { ok: false, err: 'run 终态卷双缺（cos-score.json+manifest.json 零在）——verdict 投影 fail-closed' };
  }
  const mf = JSON.parse(readFileSync(mfP, 'utf8')) as { run_state?: string };
  const rs = String(mf.run_state ?? '');
  if (rs === 'ok') return { ok: true, verdict: 'continue' };   // 轮毕候意见窗（首轮正形）
  return { ok: false, err: `manifest run_state=${rs || '缺'}（非 ok）——款三 fail-closed` };
}

/**
 * 十段链段序驱动器（D1 §四装配判读面照铸·ChainRunner 注入实现形）。
 * resumeStage=N → 从段 N 起跑（段 1..N-1 产物真值前置断言全在·缺=fail 零静默跳段）。
 */
export function makeChainRunner(paths: ChainRunnerPaths): ChainRunner & { stagesRun: string[] } {
  const py = paths.pythonBin ?? 'python3';
  const timeoutMs = paths.stageTimeoutMs ?? 900_000;
  const cogDir = path.join(paths.triCompanyRoot, 'runtime', 'cognition');
  const stagesRun: string[] = [];

  const run = async (params: RoundParams, resumeStage: number | null): Promise<RunResult> => {
    const p = params as unknown as ChainParams & Record<string, unknown>;
    const runDir = String(p.runDir ?? '');
    if (!runDir) return { ok: false, run_dir: '', aggregate: {}, err: 'params.runDir 缺——链驱动零起跑 fail-closed' };
    mkdirSync(runDir, { recursive: true });

    for (let i = 0; i < STAGES.length; i++) {
      const st = STAGES[i];
      // resume 面：段 N 起=段 1..N-1 产物真值断言（D1 §四「段 N+1 前置断言=段 N 落卷真值」形·resume 同构）
      if (resumeStage !== null && i + 1 < resumeStage) {
        const prev = path.join(runDir, st.output);
        if (!existsSync(prev)) {
          return { ok: false, run_dir: runDir, aggregate: {}, err: `resume 断言败：段 ${i + 1}(${st.name}) 产物 ${st.output} 缺——零静默跳段 fail-closed` };
        }
        continue;
      }
      // 段 N+1 前置断言=段 N 落卷真值（硬串行禁跳段——含 resume 起点段自身前置）
      if (i > 0) {
        const prevDef = STAGES[i - 1];
        const prev = path.join(runDir, prevDef.output);
        if (!existsSync(prev)) {
          return { ok: false, run_dir: runDir, aggregate: {}, err: `前置断言败：段 ${i}(${st.name}) 起跑前段 ${i}(${prevDef.name}) 产物 ${prevDef.output} 缺——硬串行禁跳段 fail-closed` };
        }
      }
      const script = path.join(cogDir, st.script);
      if (!existsSync(script)) {
        return { ok: false, run_dir: runDir, aggregate: {}, err: `段 ${i + 1}(${st.name}) CLI 缺：${st.script}（TC 检出面·fail-closed）` };
      }
      // DP-20261123-012（CTO 裁形）：spawn 面 cwd/env 自足——cwd=TC 检出根、PYTHONPATH append（非覆盖·跨平台）
      const r = spawnSync(py, [script, ...st.argv(p, runDir)], {
        encoding: 'utf8',
        timeout: st.timeoutMs ?? timeoutMs,
        cwd: paths.triCompanyRoot,
        env: { ...process.env, PYTHONPATH: appendPyPath(process.env.PYTHONPATH, paths.triCompanyRoot) },
      });
      stagesRun.push(st.name);
      if (r.error) {
        return { ok: false, run_dir: runDir, aggregate: {}, err: `段 ${i + 1}(${st.name}) 进程错：${r.error.message.slice(0, ERR_TAIL)}` };
      }
      if (r.status !== 0) {
        // dce rc=3=halt_pending_ruling 候裁态（dce_steps.py 承录形）——投影关键词入 err·裁决面可判读
        const kind = st.name === 'dce' && r.status === 3 ? 'halt_pending_ruling（候 COS 裁决）' : '';
        // stdout 尾投影（CTO 裁点 a 形 19921b1e8·第六发 preflight 检查红读数丢面修笔捆排
        // 2026-11-21——stdout 有内容才投影·空则零段零噪音；tail() 同 ERR_TAIL=200 白名单形）
        const outSeg = (r.stdout ?? '').trim() ? `｜stdout 尾：${tail(r.stdout ?? '')}` : '';
        return {
          ok: false,
          run_dir: runDir,
          aggregate: {},
          err: `段 ${i + 1}(${st.name}) rc=${r.status}${kind ? `·${kind}` : ''}｜stderr 尾：${tail(r.stderr ?? '')}${outSeg}`,
        };
      }
      if (st.redirect) {
        // stdout JSON 重定向族（preflight/qualify·CLI 头注承录形）——本件落卷
        writeFileSync(path.join(runDir, st.output), (r.stdout ?? '') , 'utf8');
      }
      // v8 item4（CEO 批）：close 后读 run_state——partial（七席未齐）→ 不发 notify_done（止链）
      if (st.name === 'close_skill') {   // v8 item4：close.json 属 close_skill 段产物
        try {
          const cdoc = JSON.parse(readFileSync(path.join(runDir, st.output), 'utf8')) as Record<string, unknown>;
          if (String(cdoc.run_state) === 'partial') {
            return {
              ok: false, run_dir: runDir, aggregate: {}, failed_stage: 'close_skill',
              err: '段 8(close_skill) partial（七席未齐·v8 item4）——不发 notify_done（cpo-1 同形）',
            };
          }
        } catch { /* close.json 坏=后续段门兜底 */ }
      }
      // ── charter 1/2/5 段门（CTO spec·CEO 批）：非 pass=止链+不 notify（后半段自然不触）──
      if (chainGateStrict()) {
        const g = gateStageResult(st, runDir);
        if (!g.ok) {
          return {
            ok: false,
            run_dir: runDir,
            aggregate: {},
            failed_stage: st.name,
            err: `段 ${i + 1}(${st.name}) 门拒（非 pass 止链·不 notify）：${g.detail}`,
          };
        }
      }
    }

    const proj = projectVerdict(runDir);
    return {
      ok: proj.ok,
      run_dir: runDir,
      aggregate: { average: proj.average, verdict: proj.verdict },
      err: proj.err,
    };
  };

  return { run, stagesRun };
}
