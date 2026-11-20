// ── FADE-001 D7 节 2b·round_runner 白盒案族 ──
// S4 断言族照铸（D1 卷 cto-round-programming-design-20261119 v3-final §四）：
//   F-1 存取权属门／F-2 四支路由含 FUSE 7→8 边界钉／F-3 程序自动边唯一性／F-4 prod 直走形
//   ＋段级重跑前置真值断言（resume 边）＋款三 fail-closed 断言＋点火/裁决 IO 断言
//   ＋D6 gate 接线断言（勘面卷 §七.2 起跑前置检查位）＋D-47 时刻制断言。
// D-46：本件测试零密值零原始 payload dump（stub 白名单形）。
// 如实注：§一C 双事件 AND 门（cos-evolution-decision）=71f2057 铸形范围外（D1 §一主形照铸·
//   增补形候变更令）——本族不铸不存案·零夹带。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runLoop, readFlag, setFlag, readRunnerState, writeRunnerState,
  FUSE_MAX_ROUNDS, EXIT_GATE,
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

function makeIo(root: string, runner: ChainRunner, probe?: () => ActivationVerdict): RoundRunnerIo {
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
function seedRuling(ruling: string): void {
  mkdirSync(path.join(root, 'state'), { recursive: true });
  writeFileSync(path.join(root, 'state', 'ceo-ruling.json'), JSON.stringify({ ruling }, null, 2), 'utf8');
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
  it('F-1e flag 值出三态域=throw（域校验 fail-closed）', () => {
    seedFlag({ flag: 'staging' as unknown as FlagVolume['flag'] });
    const io = makeIo(root, makeRunner([]).runner);
    assert.throws(() => readFlag(io), /出三态域/);
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
  it('F-2b debug 支 ruling=continue→续轮迭代', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('continue');
    const { runner, calls } = makeRunner([{ verdict: 'continue' }, { verdict: 'continue' }, { verdict: 'loop_exit' }]);
    const out = await runLoop(makeIo(root, runner), { params: { run_id: 'b1' } });
    assert.strictEqual(out.exit?.kind, 'prod');
    assert.strictEqual(calls.length, 3);
  });
  it('F-2c debug 支 ruling=terminate→break（failed·round_count 零增）', async () => {
    seedFlag({ flag: 'debug', authority_ref: 'CEO令:x' });
    seedRuling('terminate');
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
    seedRuling('maybe');
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
