// ── FADE-001 D7 节 2b·round_runner 白盒案族 ──
// S4 断言族照铸（D1 卷 cto-round-programming-design-20261119 v3-final §四）：
//   F-1 存取权属门／F-2 四支路由含 FUSE 7→8 边界钉／F-3 程序自动边唯一性／F-4 prod 直走形
//   ＋段级重跑前置真值断言（resume 边）＋款三 fail-closed 断言＋点火/裁决 IO 断言
//   ＋D6 gate 接线断言（勘面卷 §七.2 起跑前置检查位）＋D-47 时刻制断言。
// D-46：本件测试零密值零原始 payload dump（stub 白名单形）。
// 如实注：§一C 双事件 AND 门（cos-evolution-decision）=71f2057 铸形范围外（D1 §一主形照铸·
//   增补形候变更令）——本族不铸不存案·零夹带。

import { describe, it, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runLoop, readFlag, setFlag, readRunnerState, writeRunnerState, runJointReviewHook, computeJointGrade,
  nextFlagEdge, flagApprovalOwner, tryCharterHook, tryCharterMount,
  FUSE_MAX_ROUNDS, EXIT_GATE, RESUME_STAGE_RETRY,
  type RoundRunnerIo, type ChainRunner, type RunResult, type RoundParams,
  type ActivationVerdict, type FlagVolume, type RunnerState,
} from '../../src/fade001/round_runner.js';

const NOW = '2026-11-21T00:00:00Z';   // D-47 断言锚：nowIso 原值粘贴形

// ── 测试基建（stub 白名单形·每案独立 tmp queueRoot） ────────────────────

interface CallRec { params: RoundParams; resumeStage: number | null; }

function makeRunner(script: Array<Partial<RunResult> & { verdict?: string }>): { runner: ChainRunner; calls: CallRec[] } {
  const calls: CallRec[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(params, resumeStage) {
        calls.push({ params, resumeStage });
        const s = script[Math.min(i, script.length - 1)];
        i += 1;
        const r: RunResult = {
          ok: s.ok ?? true,
          run_dir: s.run_dir ?? `rd-${calls.length}`,
          aggregate: { verdict: s.verdict ?? (s.aggregate?.verdict ?? 'continue'), average: s.aggregate?.average },
          err: s.err,
        };
        return r;
      },
    },
  };
}

function makeIo(root: string, runner: ChainRunner, probe?: (checks: Record<string, unknown>) => ActivationVerdict): RoundRunnerIo {
  const io: RoundRunnerIo = { queueRoot: root, chainRunner: runner, nowIso: () => NOW };
  if (probe) io.activationProbe = probe;
  return io;
}

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'rr-wb-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function seedFlag(vol: Partial<FlagVolume> & { flag: FlagVolume['flag'] }): void {
  mkdirSync(path.join(root, 'state'), { recursive: true });
  writeFileSync(path.join(root, 'state', 'flag.json'), JSON.stringify(vol, null, 2), 'utf8');
}
function seedState(st: Partial<RunnerState>): RunnerState {
  const full: RunnerState = { round_count: 0, resume_stage: null, ...st };
  mkdirSync(path.join(root, 'state'), { recursive: true });
  writeFileSync(path.join(root, 'state', 'runner-state.json'), JSON.stringify(full, null, 2), 'utf8');
  return full;
}
function seedRuling(ruling: string, runId?: string, roundCount = 1): void {
  // DP-030 三绑形：runId 缺省=旧件形（供旧件拒案）
  mkdirSync(path.join(root, 'state'), { recursive: true });
  const doc = runId === undefined
    ? { ruling }
    : { ruling, run_id: runId, round_count: roundCount, signed_at: new Date().toISOString() };
  writeFileSync(path.join(root, 'state', 'ceo-ruling.json'), JSON.stringify(doc, null, 2), 'utf8');
}
function readFlagVol(): FlagVolume {
  return JSON.parse(readFileSync(path.join(root, 'state', 'flag.json'), 'utf8')) as FlagVolume;
}

// ── F-1 存取权属门（D1 §二·切换权=CEO 令 fail-closed） ──────────────────

describe('F-1 flag 存取权属门', () => {
  it('F-1a 无 authority_ref=拒绝（fail-closed）', () => {
    const io = makeIo(root, makeRunner([]).runner);
    assert.throws(() => setFlag(io, 'prod', null), /authority_ref 必载/);
  });
  it('F-1b 空白 ref=拒绝（fail-closed）', () => {
    const io = makeIo(root, makeRunner([]).runner);
    assert.throws(() => setFlag(io, 'test', '   '), /authority_ref 必载/);
  });
  it('F-1c 合法 ref=落卷·switched_at=nowIso 原值粘贴（D-47 断言并案）', () => {
    const io = makeIo(root, makeRunner([]).runner);
    setFlag(io, 'debug', 'CEO令:ns9-01');
    const vol = readFlagVol();
    assert.strictEqual(vol.flag, 'debug');
    assert.strictEqual(vol.authority_ref, 'CEO令:ns9-01');
    assert.strictEqual(vol.switched_at, NOW);        // D-47：件内零推算·调用面现查原值
  });
  it('F-1d 零文件缺省=test（直进形缺省面）', () => {
    const io = makeIo(root, makeRunner([]).runner);
    assert.deepStrictEqual(readFlag(io), { flag: 'test' });
  });
  it('F-1e flag 值出四态域=throw（域校验 fail-closed·P4 四态扩展）', () => {
    seedFlag({ flag: 'staging' as unknown as FlagVolume['flag'] });
    const io = makeIo(root, makeRunner([]).runner);
    assert.throws(() => readFlag(io), /出四态域/);
  });
});

// ── F-2 四支路由（225 款二·含 FUSE 7→8 边界钉） ────────────────────────

describe('F-2 四支路由', () => {
  it('F-2a test 支=直进迭代（不候裁决）·round_count 逐轮落卷', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'continue' }, { verdict: 'loop_exit' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'a1' } });
    assert.strictEqual(out.exit?.kind, 'prod');
    // rounds_run 语义=完成迭代数（rounds+=1 在轮毕·EXIT return 轮不计）——照铸形
    assert.strictEqual(out.rounds_run, 2);
    assert.strictEqual(readRunnerState(makeIo(root, runner)).round_count, 2);  // EXIT 轮 count 零增（判序在增前）
    assert.strictEqual(calls.length, 3);           // 发起链跑 3 次·完成迭代 2 轮
  });
  it('DP-009 #16 runId 贯穿轮层：链层 params.run_id→runner-state.run_id', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('continue', 'DP-009-rr-1');
    const { runner } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner), { params: { run_id: 'DP-009-rr-1' } });
    const st = readRunnerState(makeIo(root, runner));
    assert.strictEqual(st.run_id, 'DP-009-rr-1');   // 轮态持久化（恢复锚/回执归属锚）
  });
  it('DP-009 老 state 无 run_id 字段→宽容读+入口补写', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('continue', 'DP-009-rr-2');
    // 老态：file 里无 run_id 键（#16 前形）
    writeFileSync(path.join(root, 'state', 'runner-state.json'),
      JSON.stringify({ round_count: 3, resume_stage: null }, null, 2), 'utf8');
    const { runner } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner), { params: { run_id: 'DP-009-rr-2' } });
    const st = readRunnerState(makeIo(root, runner));
    assert.strictEqual(st.run_id, 'DP-009-rr-2');   // 老态补写
    assert.strictEqual(st.round_count, 4);          // 既有行为不破（3+1 轮·EXIT 轮零增）
  });
  it('F-2b debug 支 ruling=continue→单轮放行·次轮一纸一轮拒（DP-030 新正形）', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('continue', 'b1');
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'continue' }, { verdict: 'loop_exit' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'b1' } });
    assert.strictEqual(out.exit, null);              // 次轮裁决已消费→absent 挂起（一纸一轮）
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(readRunnerState(makeIo(root, runner)).ruling_consumed_ref, 'b1:1');  // 消费戳落卷
  });
  it('F-2c debug 支 ruling=terminate→break（failed·round_count 零增）', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('terminate', 'c1');
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'c1' } });
    assert.strictEqual(out.exit?.kind, 'failed');
    assert.match(out.exit?.detail ?? '', /terminate/);
    assert.strictEqual(out.rounds_run, 0);         // terminate return 在 rounds 增前（该轮未完成迭代·照铸形）
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(readRunnerState(makeIo(root, runner)).round_count, 0);  // 判序在 count 增前
  });
  it('F-2d debug 支 ruling=absent（零卷）→挂起不迭代（fail-closed·exit=null）', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'd1' } });
    assert.strictEqual(out.exit, null);
    assert.strictEqual(out.rounds_run, 0);         // absent return 在 rounds 增前（挂起轮未完成迭代·照铸形）
    assert.strictEqual(readRunnerState(makeIo(root, runner)).round_count, 0);  // 挂起零推进
    assert.strictEqual(calls.length, 1);
  });
test('DP-027 ⓑ M9 三态：test 熔断 / debug 不熔断 / prod 拦截', async () => {
  // ① test 态 round>=8 → 熔断
  seedFlag({ flag: 'test' });
  seedState({ round_count: 8 });
  {
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'm9a' } });
    assert.strictEqual(out.exit?.kind, 'fuse');
    assert.strictEqual(readRunnerState(makeIo(root, runner)).fuse_marker, true);
  }
  // ② debug 态 round>=8 → 不熔断（审批步节流为界·终止走裁决面）
  const root2 = mkdtempSync(path.join(tmpdir(), 'rr-m9b-'));
  const oldRoot = root;
  root = root2;
  try {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:m9' });
    seedState({ round_count: 8 });
    seedRuling('terminate', 'm9b');
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'm9b' } });
    assert.notStrictEqual(out.exit?.kind, 'fuse');
    assert.ok(!readRunnerState(makeIo(root, runner)).fuse_marker);
  } finally {
    root = oldRoot;
  }
  // ③ prod 态 → 起跑拦截（既有）
  const root3 = mkdtempSync(path.join(tmpdir(), 'rr-m9c-'));
  root = root3;
  try {
    seedFlag({ flag: 'prod' });
    await assert.rejects(
      runLoop(makeIo(root, makeRunner([]).runner), { params: { run_id: 'm9c' } }),
      /prod 不入 loop/,
    );
  } finally {
    root = oldRoot;
  }
});

  it('F-2e FUSE 7→8 边界钉：初值 7 第一轮推进（7→8 不熔）·第二轮毕 8>=8 熔断', async () => {
    seedState({ round_count: 7 });
    const { runner } = makeRunner([{ verdict: 'continue' }, { verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'e1' } });
    assert.strictEqual(out.exit?.kind, 'fuse');
    assert.match(out.exit?.detail ?? '', new RegExp(`round_count=8>=${FUSE_MAX_ROUNDS}`));
    const st = readRunnerState(makeIo(root, runner));
    assert.strictEqual(st.round_count, 8);
    assert.strictEqual(st.fuse_marker, true);        // fuse.marker+pending 冻结落卷
    assert.strictEqual(out.rounds_run, 1);           // 轮 1 完成（rounds 0→1）·轮 2 毕 fuse return 不计
  });
  it('F-2e2 FUSE 即熔：初值 8 第一轮毕即熔', async () => {
    seedState({ round_count: 8 });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'e2' } });
    assert.strictEqual(out.exit?.kind, 'fuse');
    assert.strictEqual(out.rounds_run, 0);           // 即熔轮未完成迭代（fuse return 在 rounds 增前·照铸形）
    assert.strictEqual(calls.length, 1);
  });
  it('F-2f EXIT 支 verdict=loop_exit→flag→prod（程序边自动写）', async () => {
    const { runner } = makeRunner([{ verdict: 'loop_exit', run_dir: 'rd-exit' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'f1' } });
    assert.strictEqual(out.exit?.kind, 'prod');
    const vol = readFlagVol();
    assert.strictEqual(vol.flag, 'prod');
    assert.strictEqual(vol.authority_ref, 'run:rd-exit');   // sanctioned 边 ref 可溯
  });
});

// ── F-3 程序自动边唯一性（EXIT≥95→prod 唯一 sanctioned 边） ─────────────


describe('DP-030 ceo-ruling 三绑与一纸一轮', () => {
  it('旧件（无 run_id/round_count/signed_at）→absent 不认', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('continue');                       // 旧形（无三绑）
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'd30a' } });
    assert.strictEqual(out.exit, null);
    assert.strictEqual(calls.length, 1);
  });
  it('跨 run 件拒（run_id 不匹配本 run）→absent', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('continue', 'other-run');
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'd30b' } });
    assert.strictEqual(out.exit, null);
  });
  it('signed_at 缺→absent（三绑不全）', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    mkdirSync(path.join(root, 'state'), { recursive: true });
    writeFileSync(path.join(root, 'state', 'ceo-ruling.json'),
      JSON.stringify({ ruling: 'continue', run_id: 'd30c', round_count: 1 }), 'utf8');
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'd30c' } });
    assert.strictEqual(out.exit, null);
  });
  it('terminate 三绑齐→terminated（failed exit）·一纸不重复消费面由 continue 案覆盖', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('terminate', 'd30d');
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'd30d' } });
    assert.strictEqual(out.exit?.kind, 'failed');
    assert.match(out.exit?.detail ?? '', /terminate/);
  });
});
describe('F-3 程序自动边唯一性', () => {
  it('F-3a 非 EXIT 轮零程序写 flag 面·EXIT 轮=唯一写面', async () => {
    const { runner } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit', run_dir: 'rd-u1' }]);
    const io = makeIo(root, runner);
    await runLoop(io, { params: { run_id: 'u0' } });   // 全程跑毕收束
    // 全程唯一 flag 写=EXIT 轮一笔（轮 1 continue 零写·flag.json 若存在只可能来自 EXIT）
    const vol = readFlagVol();
    assert.strictEqual(vol.flag, 'prod');
    assert.strictEqual(vol.authority_ref, 'run:rd-u1');
    assert.strictEqual(vol.switched_at, NOW);
  });
  it(`F-3b EXIT_GATE 值面=${EXIT_GATE}（唯一程序边线值定谳）`, () => {
    assert.strictEqual(EXIT_GATE, 95);               // ≥95 含边界·D1 §一定谳值
    assert.strictEqual(FUSE_MAX_ROUNDS, 8);          // ①护栏值面同验
  });
});

// ── F-4 prod 直走形（不入 while 体·点火面拦截） ────────────────────────

describe('F-4 prod 直走形', () => {
  it('F-4a flag=prod→runLoop 拒入（throw）·chainRunner 零调用（引擎零点火=Skill 尾零 spawn 本层语义）', async () => {
    seedFlag({ flag: 'prod', authority_ref: 'CEO令:p1' });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    await assert.rejects(
      () => runLoop(makeIo(root, runner), { params: { run_id: 'p1' } }),
      /prod 不入 loop/,
    );
    assert.strictEqual(calls.length, 0);
  });
});

// ── 段级重跑前置真值断言（resume 边·D1 §六A） ─────────────────────────

describe('R resume 续跑边', () => {
  it('R-1 resume_stage=7→每轮 chainRunner 收 resumeStage=7（恒定传递照铸形）', async () => {
    seedState({ resume_stage: 7 });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner), { params: { run_id: 'r1' } });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].resumeStage, 7);
    assert.strictEqual(calls[1].resumeStage, 7);
  });
  it('R-2 resume_stage=null→收 null（零续跑形）', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner), { params: { run_id: 'r2' } });
    assert.strictEqual(calls[0].resumeStage, null);
  });
  it('R-3 缺省 runner-state（零文件）→resume_stage=null+round_count=0', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'loop_exit' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'r3' } });
    assert.strictEqual(calls[0].resumeStage, null);
    assert.strictEqual(out.final_state.round_count, 0);
  });
});

// ── 款三 fail-closed（段报错停·notice-223） ───────────────────────────

describe('FC 款三 fail-closed', () => {
  it('FC-1 run.failed→exit=failed·err 白名单冒泡·round_count 零增·FUSE 零误触', async () => {
    const { runner, calls } = makeRunner([{ ok: false, err: '段N报错:close 落卷缺失' }, { verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'fc1' } });
    assert.strictEqual(out.exit?.kind, 'failed');
    assert.match(out.exit?.detail ?? '', /段N报错:close 落卷缺失/);
    assert.strictEqual(out.rounds_run, 0);
    assert.strictEqual(calls.length, 1);             // 停机零二次迭代
    assert.strictEqual(readRunnerState(makeIo(root, runner)).round_count, 0);
    assert.strictEqual(readRunnerState(makeIo(root, runner)).fuse_marker, undefined);
  });
});

// ── 点火/裁决 IO 断言（D1 §三·事件源 IO 面） ──────────────────────────

describe('IO 点火/裁决面', () => {
  it('IO-1 点火 params 消费=首轮收 ignite.params 原值', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner), { params: { run_id: 'ig-9', week: 'W47' } });
    assert.strictEqual(calls[0].params.run_id, 'ig-9');
    assert.strictEqual(calls[0].params.week, 'W47');
  });
  it('IO-2 自主迭代推进=nextRoundParams（round+1·round_count 随轮·非队列接力）', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner), { params: { run_id: 'io2' } });   // round 缺省→0+1=1
    assert.strictEqual(calls[1].params.round, 1);
    assert.strictEqual(calls[1].params.round_count, 1);
  });
  it('IO-3 裁决事件源=ceo-ruling.json 卷面消费·非法 ruling 值→absent（fail-closed）', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('maybe', 'io3');
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'io3' } });
    assert.strictEqual(out.exit, null);              // 非法值=absent 挂起·不误推进
  });
});

// ── D6 gate 接线（起跑前置检查位·勘面卷 §七.2） ───────────────────────

describe('G D6 gate 接线', () => {
  it('G-1 gate=blocked→起跑门闭 fail-closed（chainRunner 零调用·unmet 明细冒泡）', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    const probe = (): ActivationVerdict => ({ ok: false, gate: 'blocked', unmet: ['A2 白盒面零新增红'] });
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'g1' } });
    assert.strictEqual(out.exit?.kind, 'failed');
    assert.match(out.exit?.detail ?? '', /activation gate blocked/);
    assert.match(out.exit?.detail ?? '', /A2 白盒面零新增红/);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(out.rounds_run, 0);
  });
  it('G-2 gate=ready→正常入轮', async () => {
    const { runner, calls } = makeRunner([{ verdict: 'loop_exit' }]);
    const probe = (): ActivationVerdict => ({ ok: true, gate: 'ready', unmet: [] });
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'g2' } });
    assert.strictEqual(out.exit?.kind, 'prod');
    assert.strictEqual(calls.length, 1);
  });
});

// ── 节 3·first_round_pending 停点消费（勘面卷 §三.4 执行面·preflight 节 3 令面） ──
// 施工正身注：消费面=D1 v3-final 零载·正形源=勘面卷 §三.4 CTO 定谳（语义面=D6 件输出面·
//   执行面=runner 消费接线 loop 体域）+preflight 节 3——照定谳形施工·如实注。

function gateReady(over: Partial<ActivationVerdict> = {}): ActivationVerdict {
  return { ok: true, gate: 'ready', unmet: [], ...over };
}

describe('FR first_round_pending 停点消费', () => {
  it('FR-1 首轮毕 stop→exit kind=first_round_pending（停面候 CEO·round_count 零推进）', async () => {
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: { state: 'stop' } });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr1' } });
    assert.strictEqual(out.exit?.kind, 'first_round_pending');
    assert.match(out.exit?.detail ?? '', /停面候 CEO/);            // 停面态声明入链
    assert.strictEqual(out.rounds_run, 0);                        // 停点轮未完成迭代（照铸形）
    assert.strictEqual(readRunnerState(makeIo(root, runner)).round_count, 0);  // 停面零推进
    assert.strictEqual(calls.length, 1);                          // 首轮毕即停·零二次迭代
  });
  it('FR-2 released+ref 在→放行续轮（放行一次非逐轮·第二轮零复查）', async () => {
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: { state: 'released', authority_ref: 'CEO令:fr2' } });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr2' } });
    assert.strictEqual(out.exit?.kind, 'prod');                   // 放行→第二轮正常走完
    assert.strictEqual(calls.length, 2);
  });
  it('FR-3 state=released 但 ref 缺→拒绝 fail-closed（停面零放行·令面非时面）', async () => {
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: { state: 'released' } });
    const { runner, calls } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr3' } });
    assert.strictEqual(out.exit?.kind, 'first_round_pending');
    assert.match(out.exit?.detail ?? '', /authority_ref=缺/);
    assert.strictEqual(out.rounds_run, 0);
    assert.strictEqual(calls.length, 1);
  });
  it('FR-4 ref 空白串=同缺（trim 面 fail-closed）', async () => {
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: { state: 'released', authority_ref: '   ' } });
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr4' } });
    assert.strictEqual(out.exit?.kind, 'first_round_pending');
    assert.strictEqual(out.rounds_run, 0);
  });
  it('FR-5 state 非法值→fail-closed 停面（零放行）', async () => {
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: { state: 'unknown' as 'stop' } });
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr5' } });
    assert.strictEqual(out.exit?.kind, 'first_round_pending');
    assert.match(out.exit?.detail ?? '', /state=unknown/);
    assert.strictEqual(out.rounds_run, 0);
  });
  it('FR-6 first_round_pending 缺省/null→零停点直进', async () => {
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: null });
    const { runner, calls } = makeRunner([{ verdict: 'loop_exit' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr6' } });
    assert.strictEqual(out.exit?.kind, 'prod');
    assert.strictEqual(calls.length, 1);
  });
  it('FR-7 呈报载荷出链=白名单投影（plain_line 入 detail·brief 其他键零 dump——D-46）', async () => {
    const probe = (): ActivationVerdict => gateReady({
      first_round_pending: { state: 'stop', brief: { plain_line: '大白话：首轮毕停点候放行', other_key: { nested: 'payload' } } },
    });
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'fr7' } });
    assert.match(out.exit?.detail ?? '', /大白话：首轮毕停点候放行/);
    assert.ok(!(out.exit?.detail ?? '').includes('other_key'));    // 零原始 brief dump
    assert.ok(!(out.exit?.detail ?? '').includes('nested'));
  });
});

describe('GW gate 喂入接线（A1-A4 采集位=调用面·runner 只透传零判读）', () => {
  it('GW-1 ignite.checks 透传 probe', async () => {
    let seen: Record<string, unknown> | null = null;
    const probe = (checks: Record<string, unknown>): ActivationVerdict => { seen = checks; return gateReady(); };
    const { runner } = makeRunner([{ verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner, probe), { params: { run_id: 'gw1' }, checks: { A1: '白盒零新增红', A4: true } });
    assert.deepStrictEqual(seen, { A1: '白盒零新增红', A4: true });
  });
  it('GW-2 checks 缺省→probe 收空对象（零喂入缺省形）', async () => {
    let seen: Record<string, unknown> | null = null;
    const probe = (checks: Record<string, unknown>): ActivationVerdict => { seen = checks; return gateReady(); };
    const { runner } = makeRunner([{ verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner, probe), { params: { run_id: 'gw2' } });
    assert.deepStrictEqual(seen, {});
  });
  it('GW-3 probe 全程只调一次（起跑前置位·非逐轮）', async () => {
    let n = 0;
    const probe = (): ActivationVerdict => { n += 1; return gateReady(); };
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'loop_exit' }]);
    await runLoop(makeIo(root, runner, probe), { params: { run_id: 'gw3' } });
    assert.strictEqual(n, 1);                                     // 两轮迭代·probe 仍一次
    assert.strictEqual(calls.length, 2);
  });
});

describe('RR resume 轮间指令面', () => {
  it('RR-1 RESUME_STAGE_RETRY 值面=7（D5 拟稿 schema 承·--resume-stage 7 形锚）', () => {
    assert.strictEqual(RESUME_STAGE_RETRY, 7);
  });
});

describe('GD 护栏随铸（D-46/D-47 白盒）', () => {
  it('GD-1 exit detail 全四支零时刻嵌值（D-47 件内零推算·构造面零时戳拼接）', async () => {
    // prod 支（先行·后支各自重置 flag——同 root 四支串行防状态污染）
    const p1 = makeRunner([{ verdict: 'loop_exit', run_dir: 'gd-p' }]);
    const o1 = await runLoop(makeIo(root, p1.runner), { params: { run_id: 'gd1' } });
    assert.ok(!(o1.exit?.detail ?? '').includes(NOW));
    // fuse 支
    seedFlag({ flag: 'test' });
    seedState({ round_count: 8 });
    const p2 = makeRunner([{ verdict: 'continue' }]);
    const o2 = await runLoop(makeIo(root, p2.runner), { params: { run_id: 'gd1' } });
    assert.strictEqual(o2.exit?.kind, 'fuse');
    assert.ok(!(o2.exit?.detail ?? '').includes(NOW));
    // failed 支
    seedFlag({ flag: 'test' });
    seedState({ round_count: 0 });
    const p3 = makeRunner([{ ok: false, err: 'gd 段错' }]);
    const o3 = await runLoop(makeIo(root, p3.runner), { params: { run_id: 'gd1' } });
    assert.strictEqual(o3.exit?.kind, 'failed');
    assert.ok(!(o3.exit?.detail ?? '').includes(NOW));
    // first_round_pending 支
    seedFlag({ flag: 'test' });
    seedState({ round_count: 0 });
    const p4 = makeRunner([{ verdict: 'continue' }]);
    const probe = (): ActivationVerdict => gateReady({ first_round_pending: { state: 'stop' } });
    const o4 = await runLoop(makeIo(root, p4.runner, probe), { params: { run_id: 'gd1' } });
    assert.strictEqual(o4.exit?.kind, 'first_round_pending');
    assert.ok(!(o4.exit?.detail ?? '').includes(NOW));
  });
  it('GD-2 停面零密值落卷（final_state 白名单域·卷面零 brief 承载——D-46）', async () => {
    const probe = (): ActivationVerdict => gateReady({
      first_round_pending: { state: 'stop', brief: { plain_line: 'x', raw_payload: { k: 'v' } } },
    });
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const out = await runLoop(makeIo(root, runner, probe), { params: { run_id: 'gd2' } });
    // 停面零写卷（final_state 只在 outcome 返回面·零文件=零密值落盘正形——照铸形）
    assert.strictEqual(existsSync(path.join(root, 'state', 'runner-state.json')), false);
    const keys = Object.keys(out.final_state);
    // DP-009 #16：run_id 入白名单（非密值·派工锚·CTO e9fb4dddc §二关联行）——余键仍零承载
    assert.ok(keys.every((k) => ['round_count', 'resume_stage', 'fuse_marker', 'run_id'].includes(k)));  // 白名单域外零承载
    assert.strictEqual('brief' in out.final_state, false);        // 呈报载荷走 exit detail 投影面零入 state
  });
});

test('P4 挂载 choreography（CTO 裁第三形）：批准后挂树复制形/幂等/无 ref=no-op/树规范周目录', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rr-mnt-'));
  const tmv = mkdtempSync(path.join(tmpdir(), 'rr-tmv-'));
  const runDir = mkdtempSync(path.join(tmpdir(), 'rr-rd-'));
  try {
    const io = makeIo(root, makeRunner([]), undefined);
    const st: any = { round_count: 1 };
    const params = { run_id: 'm1', runDir, tmvRoot: tmv, fromWeek: '2026-W47' };
    // no-op：无 pending ref
    await tryCharterMount(io, st, params);
    assert.equal(st.charter_approval, undefined);
    // 挂载：有 ref（复制形+周目录）
    const charter = path.join(runDir, 'charter-x.json');
    writeFileSync(charter, '{"k":1}');
    st.pending_charter_ref = charter;
    st.charter_approval = 'CEO';  // 待批态
    const mErrs: string[] = [];
    const oErr = console.error;
    console.error = (...a: unknown[]) => { mErrs.push(a.map(String).join(' ')); };
    try { await tryCharterMount(io, st, params); } finally { console.error = oErr; }
    if (mErrs.length) console.log('MOUNT-ERR:', mErrs.join(' | '));
    assert.equal(st.charter_approval, 'APPROVED_CEO');
    const treesDir = path.join(tmv, 'docs', 'workflow', 'operating-records', '2026-W47', 'trees');
    assert.ok(readdirSync(treesDir).some((d) => d.startsWith('fade001-evolve-')), '树规范周目录挂载');
    // 幂等
    const before = st.charter_approval;
    await tryCharterMount(io, st, params);
    assert.equal(st.charter_approval, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tmv, { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('P4 接线件 hook 三态：no-op（无 opinions）/fail-closed（坏 opinions 不写 pending）/成功（写 ref+CEO approval）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rr-hook-'));
  try {
    const io = makeIo(root, makeRunner([]), undefined);
    const st: any = { round_count: 1 };
    // 1) no-op
    await tryCharterHook(io, st, { run_id: 'h1', runDir: root });
    assert.equal(st.pending_charter_ref, undefined);
    // 2) fail-closed（坏卷）
    writeFileSync(path.join(root, 'opinions.json'), '{}');
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.map(String).join(' ')); };
    try { await tryCharterHook(io, st, { run_id: 'h1', runDir: root }); } finally { console.error = origErr; }
    assert.equal(st.pending_charter_ref, undefined);
    assert.ok(errs.some((l) => l.includes('charter-hook')), 'fail-closed 如实留痕');
    // 3) 成功（合法五字段卷）
    writeFileSync(path.join(root, 'opinions.json'), JSON.stringify({
      schema_version: '1.0.0', run_id: 'h1',
      opinions: [{ opinion_id: 'op1', title: 't', target: 'a.ts', change: 'c', verify: 'v', rollback: 'r' }],
    }));
    await tryCharterHook(io, st, { run_id: 'h1', runDir: root });
    assert.ok(typeof st.pending_charter_ref === 'string' && st.pending_charter_ref.length > 0);
    assert.equal(st.charter_approval, 'CEO');
    assert.ok(existsSync(st.pending_charter_ref));
    // 4) 幂等：再调不重复
    const first = st.pending_charter_ref;
    await tryCharterHook(io, st, { run_id: 'h1', runDir: root });
    assert.equal(st.pending_charter_ref, first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('P4 六边状态机：E1 prod<=95→test / E2 test 8轮>95→debug / E5 test>95→prod / E3 debug+融合→test / 批准权 CEO|COS', () => {
  // DP-027 ⓐ：双信号（E1/E2/E5 需 avgA+avgB 双达标；单 side=无信号）
  assert.equal(nextFlagEdge('prod', { avgA: 90, avgB: 93 })?.edge, 'E1_prod_low');
  assert.equal(nextFlagEdge('prod', { avgA: 90 }), null);                      // 缺 side=无信号
  assert.equal(nextFlagEdge('prod', { average: 90 }), null);                   // 单 side aggregate.average 已废止
  assert.equal(nextFlagEdge('prod', { avgA: 96, avgB: 97 }), null);
  assert.equal(nextFlagEdge('test', { avgA: 90, avgB: 91, roundsSinceFlag: 8 })?.edge, 'E2_test_stuck');  // 双低 8 轮
  assert.equal(nextFlagEdge('test', { avgA: 90, avgB: 96, roundsSinceFlag: 8 }), null);  // 单低=不 stuck（双达标）
  assert.equal(nextFlagEdge('test', { avgA: 90, avgB: 90, roundsSinceFlag: 3 }), null);  // 未到 8 轮
  assert.equal(nextFlagEdge('test', { avgA: 96, avgB: 97 })?.edge, 'E5_test_high');
  const e3 = nextFlagEdge('debug', { opinionsFused: true });
  assert.equal(e3?.edge, 'E3_debug_back');
  assert.equal(flagApprovalOwner(e3!), 'CEO');
  assert.equal(flagApprovalOwner(nextFlagEdge('test', { avgA: 96, avgB: 97 })!), 'COS');
});


function tcRec(_root: string): string {
  return mkdtempSync(path.join(tmpdir(), 'dp014g-rd-'));
}



test('DP-021 grade 单源：computeJointGrade 门槛 A>90 && B>90（边界 90=不达）', () => {
  const pass = computeJointGrade({ seat_means: { a: 91, b: 92 } });
  assert.deepEqual(pass, { a: 91, b: 92, bothPass: true });
  const boundary = computeJointGrade({ seat_means: { a: 90, b: 95 } });
  assert.equal(boundary.bothPass, false);
  const fromFaces = computeJointGrade({ faces: {
    s1: { dimensions: [{ object: 'a', score: 95 }, { object: 'b', score: 96 }] },
    s2: { dimensions: [{ object: 'a', score: 97 }, { object: 'b', score: 94 }] },
  } });
  assert.equal(fromFaces.bothPass, true);
  assert.equal(fromFaces.a, 96);
  assert.equal(fromFaces.b, 95);
});

test('DP-021 达标轮：charter skip 留痕（charter-skip.json·pending 零写）', async () => {
  const tcRoot = mkdtempSync(path.join(tmpdir(), 'dp021-tc-'));
  const cogDir = path.join(tcRoot, 'runtime', 'cognition');
  mkdirSync(cogDir, { recursive: true });
  const rd = mkdtempSync(path.join(tmpdir(), 'dp021-rd-'));
  // stub 联审脚本：rc=0 且写 joint-review.json（both pass）
  const pyStub = [
    'import json, sys, os',
    `open(r"${path.join(rd, 'joint-review.json')}", "w").write(json.dumps({"seat_means": {"a": 95.0, "b": 96.0}}))`,
    'sys.exit(0)',
    '',
  ].join(String.fromCharCode(10));
  writeFileSync(path.join(cogDir, 'loop_joint_review_spawn.py'), pyStub, 'utf8');
  const root = mkdtempSync(path.join(tmpdir(), 'dp021-q-'));
  const oldEnv = { cog: process.env.TRICO_COGNITION_DIR, py: process.env.FADE_PYTHON, jr: process.env.LOOP_JOINT_REVIEW };
  process.env.TRICO_COGNITION_DIR = cogDir;
  process.env.FADE_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
  delete process.env.LOOP_JOINT_REVIEW;
  try {
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const st: RunnerState = { round_count: 0, resume_stage: null };
    const res = await runJointReviewHook(makeIo(root, runner), st, { runDir: rd, run_id: 'dp021' } as never) as { charter: string };
    assert.equal(res.charter, 'skipped');
    assert.equal(st.pending_charter_ref, undefined);                       // pending 零写
    assert.equal(existsSync(path.join(rd, 'charter-skip.json')), true);    // 留痕
  } finally {
    if (oldEnv.cog === undefined) delete process.env.TRICO_COGNITION_DIR; else process.env.TRICO_COGNITION_DIR = oldEnv.cog;
    if (oldEnv.py === undefined) delete process.env.FADE_PYTHON; else process.env.FADE_PYTHON = oldEnv.py;
    if (oldEnv.jr !== undefined) process.env.LOOP_JOINT_REVIEW = oldEnv.jr;
  }
});

test('DP-021 未达标轮：走 charter 生成链（attempted 且无 skip 文件）', async () => {
  const tcRoot = mkdtempSync(path.join(tmpdir(), 'dp021b-tc-'));
  const cogDir = path.join(tcRoot, 'runtime', 'cognition');
  mkdirSync(cogDir, { recursive: true });
  const rd = mkdtempSync(path.join(tmpdir(), 'dp021b-rd-'));
  const pyStub = [
    'import json, sys',
    `open(r"${path.join(rd, 'joint-review.json')}", "w").write(json.dumps({"seat_means": {"a": 50.0, "b": 60.0}}))`,
    'sys.exit(0)',
    '',
  ].join(String.fromCharCode(10));
  writeFileSync(path.join(cogDir, 'loop_joint_review_spawn.py'), pyStub, 'utf8');
  const root = mkdtempSync(path.join(tmpdir(), 'dp021b-q-'));
  const oldEnv = { cog: process.env.TRICO_COGNITION_DIR, py: process.env.FADE_PYTHON, jr: process.env.LOOP_JOINT_REVIEW };
  process.env.TRICO_COGNITION_DIR = cogDir;
  process.env.FADE_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
  delete process.env.LOOP_JOINT_REVIEW;
  try {
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const st: RunnerState = { round_count: 0, resume_stage: null };
    const res = await runJointReviewHook(makeIo(root, runner), st, { runDir: rd, run_id: 'dp021b' } as never) as { charter: string };
    assert.equal(res.charter, 'attempted');
    assert.equal(existsSync(path.join(rd, 'charter-skip.json')), false);
  } finally {
    if (oldEnv.cog === undefined) delete process.env.TRICO_COGNITION_DIR; else process.env.TRICO_COGNITION_DIR = oldEnv.cog;
    if (oldEnv.py === undefined) delete process.env.FADE_PYTHON; else process.env.FADE_PYTHON = oldEnv.py;
    if (oldEnv.jr !== undefined) process.env.LOOP_JOINT_REVIEW = oldEnv.jr;
  }
});

test('DP-014 守卫双修三态：本 run pending 挡 / 他 run pending 不挡 / approved 放行', async () => {
  const mkStub = () => {
    const tcRoot = mkdtempSync(path.join(tmpdir(), 'dp014g-tc-'));
    const cogDir = path.join(tcRoot, 'runtime', 'cognition');
    mkdirSync(cogDir, { recursive: true });
    const marker = path.join(tcRoot, 'spawned.marker');
    const pyStub = [
      'import os, sys',
      `open(r"${marker}", "w").write("1")`,
      'sys.exit(3)',
      '',
    ].join(String.fromCharCode(10));
    writeFileSync(path.join(cogDir, 'loop_joint_review_spawn.py'), pyStub, 'utf8');
    return { tcRoot, cogDir, marker };
  };
  const old = { cog: process.env.TRICO_COGNITION_DIR, py: process.env.FADE_PYTHON, jr: process.env.LOOP_JOINT_REVIEW };
  process.env.FADE_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
  delete process.env.LOOP_JOINT_REVIEW;
  try {
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    // ① 本 run pending → 守卫短路（不 spawn）
    {
      const { cogDir, marker } = mkStub();
      process.env.TRICO_COGNITION_DIR = cogDir;
      const root = mkdtempSync(path.join(tmpdir(), 'dp014g-q1-'));
      const st = { round_count: 0, resume_stage: null, pending_charter_ref: '/x/charter.json', charter_run_id: 'r1' };
      await runJointReviewHook(makeIo(root, runner), st as never, { runDir: tcRec(root), run_id: 'r1' } as never);
      assert.equal(existsSync(marker), false);
    }
    // ② 他 run pending → 不挡（spawn 发生）
    {
      const { cogDir, marker } = mkStub();
      process.env.TRICO_COGNITION_DIR = cogDir;
      const root = mkdtempSync(path.join(tmpdir(), 'dp014g-q2-'));
      const st = { round_count: 0, resume_stage: null, pending_charter_ref: '/x/charter.json', charter_run_id: 'r0-old' };
      await runJointReviewHook(makeIo(root, runner), st as never, { runDir: tcRec(root), run_id: 'r2' } as never);
      assert.equal(existsSync(marker), true);
    }
    // ③ approved + 本 run pending → 放行（spawn 发生）
    {
      const { cogDir, marker } = mkStub();
      process.env.TRICO_COGNITION_DIR = cogDir;
      const root = mkdtempSync(path.join(tmpdir(), 'dp014g-q3-'));
      const st = { round_count: 0, resume_stage: null, pending_charter_ref: '/x/charter.json', charter_run_id: 'r3', charter_approval: 'APPROVED_CEO' };
      await runJointReviewHook(makeIo(root, runner), st as never, { runDir: tcRec(root), run_id: 'r3' } as never);
      assert.equal(existsSync(marker), true);
    }
  } finally {
    if (old.cog === undefined) delete process.env.TRICO_COGNITION_DIR; else process.env.TRICO_COGNITION_DIR = old.cog;
    if (old.py === undefined) delete process.env.FADE_PYTHON; else process.env.FADE_PYTHON = old.py;
    if (old.jr !== undefined) process.env.LOOP_JOINT_REVIEW = old.jr;
  }
});

test('DP-014 hook spawn env/cwd 自足：子进程 cwd=TC根·PYTHONPATH 含 TC根（stub 实读）', async () => {
  const tcRoot = mkdtempSync(path.join(tmpdir(), 'dp014-tc-'));
  const cogDir = path.join(tcRoot, 'runtime', 'cognition');
  mkdirSync(cogDir, { recursive: true });
  const probeOut = path.join(tcRoot, 'probe.json');
  // stub：回写 cwd+PYTHONPATH 后 rc=3（非零→钩 fail-closed 即返回·不触 tryCharterHook）
  const pyStub = [
    'import os, json, sys',
    `open(r"${probeOut}", "w").write(json.dumps({"cwd": os.getcwd(), "pp": os.environ.get("PYTHONPATH", "")}))`,
    'sys.exit(3)',
    '',
  ].join('\n');
  writeFileSync(path.join(cogDir, 'loop_joint_review_spawn.py'), pyStub, 'utf8');
  const root = mkdtempSync(path.join(tmpdir(), 'dp014-q-'));
  const rd = mkdtempSync(path.join(tmpdir(), 'dp014-rd-'));
  const old = { cog: process.env.TRICO_COGNITION_DIR, py: process.env.FADE_PYTHON, jr: process.env.LOOP_JOINT_REVIEW };
  process.env.TRICO_COGNITION_DIR = cogDir;
  process.env.FADE_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
  delete process.env.LOOP_JOINT_REVIEW;
  try {
    const { runner } = makeRunner([{ verdict: 'continue' }]);
    const st = { round_count: 0, resume_stage: null };
    await runJointReviewHook(makeIo(root, runner), st, { runDir: rd, run_id: 'dp014' } as never);
    const probe = JSON.parse(readFileSync(probeOut, 'utf8'));
    assert.equal(probe.cwd, tcRoot);                       // cwd=TC 检出根
    assert.ok(String(probe.pp).split(path.delimiter).includes(tcRoot));  // PYTHONPATH 含 TC 根（append·不覆盖）
  } finally {
    if (old.cog === undefined) delete process.env.TRICO_COGNITION_DIR; else process.env.TRICO_COGNITION_DIR = old.cog;
    if (old.py === undefined) delete process.env.FADE_PYTHON; else process.env.FADE_PYTHON = old.py;
    if (old.jr !== undefined) process.env.LOOP_JOINT_REVIEW = old.jr;
  }
});
