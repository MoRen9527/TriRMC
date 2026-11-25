// ── FADE-001 D7 节 4·chain_runner 白盒案族 ──
// 施工纪律：stub python 形零真实 CLI 零真实 7 席 spawn 零真实迁移（GLM 轨单跑·施工期白盒
// 一律 mock 形——D2 令 2 风险面承录）——stubAll 铸临时 TC 检出根+per-test 专属 stub 脚本集。
// 案族照 D1 §四装配正形+round_runner 白盒先例形（node:test·.js 后缀 import）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { STAGES, makeChainRunner, SPAWN_STAGE_TIMEOUT_MS, appendPyPath, gateStageResult } from '../../src/fade001/chain_runner.js';

const PY = process.platform === 'win32' ? 'python' : 'python3';

interface StubBehavior { rc?: number; stdout?: string; write?: string; body?: string; stderr?: string }

/** per-test 专属 stub 检出根：runtime/cognition/<script> 一脚本一行为（零共享零污染） */
function stubAll(behavior: Record<string, StubBehavior>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'd7-chain-'));
  const cog = path.join(root, 'runtime', 'cognition');
  mkdirSync(cog, { recursive: true });
  for (const st of STAGES) {
    const b = behavior[st.name] ?? {};
    const lines: string[] = ['import sys, os'];
    if (b.stdout !== undefined) lines.push(`sys.stdout.write(${JSON.stringify(b.stdout)})`);
    if (b.stderr !== undefined) lines.push(`sys.stderr.write(${JSON.stringify(b.stderr)})`);
    if (b.write) {
      lines.push(`os.makedirs(os.path.dirname(${JSON.stringify(b.write)}), exist_ok=True)`);
      lines.push(`open(${JSON.stringify(b.write)}, 'w', encoding='utf-8').write(${JSON.stringify(b.body ?? '{}')})`);
    }
    lines.push(`sys.exit(${b.rc ?? 0})`);
    writeFileSync(path.join(cog, st.script), lines.join('\n'), 'utf8');
  }
  return root;
}

/** 全绿基线行为：十段 rc=0+自落卷段产物真值落卷（redirect 段走 stdout 形·manifest 载 run_state=ok 对表投影 schema） */
function greenBehavior(runDir: string): Record<string, StubBehavior> {
  const b: Record<string, StubBehavior> = {
    preflight: { stdout: '{"gate":"ok"}' },
    qualify: { stdout: '{"qualify":"ok"}' },
  };
  for (const st of STAGES) {
    if (st.redirect) continue;
    const body = st.name === 'close' ? '{"run_state":"ok"}' : '{"verdict":"pass"}';
    b[st.name] = { write: path.join(runDir, st.output), body };
  }
  return b;
}

function makeEnv(): { root: string; runDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'd7-env-'));
  const runDir = path.join(root, 'run-0001');
  mkdirSync(runDir, { recursive: true });   // 预置写卷案基座（writeFileSync 不自动建目录）
  return { root, runDir };
}

function runnerFor(root: string) {
  return makeChainRunner({ triCompanyRoot: root, pythonBin: PY, stageTimeoutMs: 30_000 });
}

function params(runDir: string) {
  return { runDir, runId: 'rd-test', fromWeek: '2026-W47', toWeek: '2026-W48', startDate: '2026-11-23', tmvRoot: 'D:/tmp/tmv' } as never;
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test('DP-012 appendPyPath：append 非覆盖/去重/空值兜底（CTO 裁形）', () => {
  const n = path.delimiter;
  assert.strictEqual(appendPyPath(undefined, '/tc'), '/tc');
  assert.strictEqual(appendPyPath('', '/tc'), '/tc');
  assert.strictEqual(appendPyPath('/a' + n + '/b', '/tc'), '/a' + n + '/b' + n + '/tc');
  assert.strictEqual(appendPyPath('/a' + n + '/tc', '/tc'), '/a' + n + '/tc');  // 去重
});

test('CS-1 十段硬串行全跑序：stagesRun=段表序·manifest ok→verdict=continue（首轮候意见窗）', async () => {
  const { root, runDir } = makeEnv();
  try {
    const r = runnerFor(stubAll(greenBehavior(runDir)));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, true);
    assert.deepEqual(r.stagesRun, STAGES.map((s) => s.name));
    assert.equal(out.aggregate.verdict, 'continue');
    assert.equal(out.run_dir, runDir);
    // stdout 重定向族产物在（本件落卷形·preflight 头注承）
    assert.equal(existsSync(path.join(runDir, 'preflight.json')), true);
    assert.equal(existsSync(path.join(runDir, 'qualify.json')), true);
  } finally { cleanup(root); }
});

test('CS-2 前置断言败停段：段 3 零落卷→段 4 起跑前断言败 fail-closed·零续跑', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.plan_scope = { rc: 0 };                       // 段 3 rc=0 但零落卷（哑卷防线面·产物真值断言抓）
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /前置断言败/);
    assert.match(String(out.err), /plan\.json 缺/);
    assert.deepEqual(r.stagesRun, ['preflight', 'qualify', 'plan_scope']);   // 止于段 3·dce 零起跑
  } finally { cleanup(root); }
});

test('CS-3 redirect 族落卷=stdout 原文（preflight/qualify 双段）', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.preflight = { stdout: '{"pf":1}\n' };
    b.qualify = { stdout: '{"qf":2}\n' };
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, true);
    // win python stdout 文本模式 \n→\r\n（平台行为如实档）——行尾归一后比对原文
    const norm = (s: string) => s.replace(/\r\n/g, '\n');
    assert.equal(norm(readFileSync(path.join(runDir, 'preflight.json'), 'utf8')), '{"pf":1}\n');
    assert.equal(norm(readFileSync(path.join(runDir, 'qualify.json'), 'utf8')), '{"qf":2}\n');
  } finally { cleanup(root); }
});

test('CS-4 rc=2 fail 投影：err 含段名+rc+stderr 尾+stdout 尾·零续段', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.qualify = { rc: 2, stderr: 'boom: no repo', stdout: '{"verdict":"fail","reasons":["red-check"]}' };
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /段 2\(qualify\) rc=2/);
    assert.match(String(out.err), /boom: no repo/);
    assert.match(String(out.err), /stdout 尾/);                    // stdout 投影修笔（CTO 裁 a 形·读数丢面堵）
    assert.match(String(out.err), /red-check/);
    assert.deepEqual(r.stagesRun, ['preflight', 'qualify']);
  } finally { cleanup(root); }
});

test('CS-4b stdout 空=投影零段零噪音（rc≠0 面 stderr 单独承载）', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.qualify = { rc: 2, stderr: 'boom only' };                     // stdout 空
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.doesNotMatch(String(out.err), /stdout 尾/);
  } finally { cleanup(root); }
});

test('CS-14 段 5 verify argv 必传 operating-root/start-date（绝对形 tmv-root 拼装）+ 段 3 spawn 形 run 面 argv（v7 flip 随勘）', () => {
  const p = { runDir: 'R', runId: 'I', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never;
  const expectRoot = path.join('T', 'docs/workflow/operating-records');
  // 段 5 verify：operating-root/start-date 必传（绝对拼装形·不变）
  const argv5 = STAGES[4].argv(p, 'R');
  const oi = argv5.indexOf('--operating-root');
  const si = argv5.indexOf('--start-date');
  assert.ok(oi !== -1, '段 5(--operating-root 缺)');
  assert.equal(argv5[oi + 1], expectRoot, '段 5(operating-root 非绝对拼装形)');
  assert.ok(si !== -1, '段 5(--start-date 缺)');
  assert.equal(argv5[si + 1], '2026-01-05');
  // 段 3 spawn 形：run 面 argv（run-dir/run-id/from/to·v7 flip 后默认）
  const argv3 = STAGES[2].argv(p, 'R');
  assert.deepEqual(argv3, ['--run-dir', 'R', '--run-id', 'I', '--from-week', 'W1', '--to-week', 'W2', '--stage-budget', '480', '--tmv-root', 'T']);   // DP-020 c + DP-018 增强器读面
});

test('DP-031 ② preflight argv 显式 --prev-runs-root（=runDir 父）', () => {
  const p = { runDir: '/runs/some-run', runId: 'I', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05' } as never;
  const argv = STAGES[0].argv(p, '/runs/some-run');
  const i = argv.indexOf('--prev-runs-root');
  assert.ok(i !== -1, '--prev-runs-root 缺');
  assert.equal(argv[i + 1], '/runs');
  const rd = argv.indexOf('--run-dir');
  assert.equal(argv[rd + 1], '/runs/some-run');
});

test('CS-5 dce rc=3=halt_pending_ruling 候裁态投影（关键词入 err·裁决面可判读）', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.dce = { rc: 3, stderr: 'verdict halt' };
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /halt_pending_ruling/);
    assert.match(String(out.err), /候 COS 裁决/);
    assert.deepEqual(r.stagesRun, ['preflight', 'qualify', 'plan_scope', 'dce']);
  } finally { cleanup(root); }
});

test('CS-6 verdict 95 线程序边：avg=95→loop_exit 含边界·avg=94→continue（cos-score.json 真值源）', async () => {
  for (const [avg, want] of [[95, 'loop_exit'], [94, 'continue']] as const) {
    const { root, runDir } = makeEnv();
    try {
      const r = runnerFor(stubAll(greenBehavior(runDir)));
      writeFileSync(path.join(runDir, 'cos-score.json'), JSON.stringify({ eviction_decision: 'evolve', joint_review_avg_score: avg }), 'utf8');
      const out = await r.run(params(runDir), null);
      assert.equal(out.ok, true);
      assert.equal(out.aggregate.verdict, want, `avg=${avg}`);
      assert.equal(out.aggregate.average, avg);
    } finally { cleanup(root); }
  }
});

test('CS-7 manifest 缺→段 10 起跑前置断言拦 fail-closed（硬串行真值面·投影双缺分支=不可达防御面如实注）', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    delete b.close;                                 // 段 9 rc=0 但零落卷 manifest
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /前置断言败/);
    assert.match(String(out.err), /manifest\.json 缺/);
    assert.equal(r.stagesRun[r.stagesRun.length - 1], 'close');   // 止于段 9·notify_done 零起跑
  } finally { cleanup(root); }
});

test('CS-8 manifest run_state 非 ok（failed/stale）→ok=false err 投影', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.close = { write: path.join(runDir, 'manifest.json'), body: '{"run_state":"stale"}' };
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /run_state=stale/);
  } finally { cleanup(root); }
});

test('CS-9 resume 轮间面：resumeStage=7→段 1-6 产物真值断言+从段 7 起五段跑序', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    const r = runnerFor(stubAll(b));
    // 预置段 1-6 产物真值（resume 前置断言域）
    for (const st of STAGES.slice(0, 6)) writeFileSync(path.join(runDir, st.output), '{"pre":true}\n', 'utf8');
    const out = await r.run(params(runDir), 7);
    assert.equal(out.ok, true);
    assert.deepEqual(r.stagesRun, STAGES.slice(6).map((s) => s.name));   // score_skill 起 5 段
  } finally { cleanup(root); }
});

test('CS-9b resume 断言败：resumeStage=7 但段 5 产物缺→fail 零静默跳段', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    delete b.verify;                                // 段 5 verify.json 零预置零重产
    const r = runnerFor(stubAll(b));
    for (const st of STAGES.slice(0, 6).filter((s) => s.name !== 'verify')) {
      writeFileSync(path.join(runDir, st.output), '{"pre":true}\n', 'utf8');
    }
    const out = await r.run(params(runDir), 7);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /resume 断言败/);
    assert.match(String(out.err), /verify\.json 缺/);
    assert.equal(r.stagesRun.length, 0);            // 全程零段起跑（断言前置拦）
  } finally { cleanup(root); }
});

test('CS-10 CLI 缺 fail-closed：零 stub 段→ok=false·CLI 名入 err', async () => {
  const { runDir } = makeEnv();
  const stubRoot = stubAll({});
  try {
    rmSync(path.join(stubRoot, 'runtime', 'cognition', 'preflight.py'));   // 删 stub 根内段 1 CLI
    const r = runnerFor(stubRoot);
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /CLI 缺/);
    assert.match(String(out.err), /preflight\.py/);
  } finally { cleanup(stubRoot, path.dirname(runDir)); }
});

test('CS-11 runDir 缺 fail-closed：params.runDir 空→零起跑', async () => {
  const root = stubAll({});
  try {
    const r = runnerFor(root);
    const out = await r.run({ runDir: '' } as never, null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /runDir 缺/);
    assert.equal(r.stagesRun.length, 0);
  } finally { cleanup(root); }
});

test('CS-12 段序表值面：十段名+产物名+spawn 段=score_skill（spawn 七席通道接装面锚）', () => {
  assert.equal(STAGES.length, 10);
  assert.deepEqual(STAGES.map((s) => s.name),
    ['preflight', 'qualify', 'plan_scope', 'dce', 'verify', 'score', 'score_skill', 'close_skill', 'close', 'notify_done']);
  assert.deepEqual(STAGES.map((s) => s.output),
    ['preflight.json', 'qualify.json', 'plan.json', 'dce.json', 'verify.json', 'score.json', 'score-skill.json', 'close.json', 'manifest.json', 'notify_done.json']);
  const spawnSeg = STAGES.find((s) => s.name === 'score_skill');
  assert.equal(spawnSeg?.script, 'score_skill_spawn.py');
});

test('P3→v7 flip：段 3/8 默认 spawn script（CEO v7 任务书·env =0 回 CLI 形=回滚锚）', () => {
  assert.equal(STAGES[2].script, 'plan_skill_spawn.py');   // flip 后默认 spawn 形
  assert.equal(STAGES[7].script, 'close_skill_spawn.py');
});




test('dce argv 两参（A 案）：dry_run 态含 --start-date/--operating-root 且无 --execute', () => {
  const old = process.env.DCE_EXECUTE;
  delete process.env.DCE_EXECUTE;
  try {
    const argv = STAGES.find((s) => s.name === 'dce')!.argv({ runDir: 'R', runId: 'I', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, 'R');
    assert.ok(!argv.includes('--execute'));
    const si = argv.indexOf('--start-date');
    assert.ok(si !== -1 && argv[si + 1] === '2026-01-05');
    const oi = argv.indexOf('--operating-root');
    assert.ok(oi !== -1 && argv[oi + 1] === path.join('T', 'docs/workflow/operating-records'));
  } finally {
    if (old !== undefined) process.env.DCE_EXECUTE = old;
  }
});

test('dce 执行开关：DCE_EXECUTE=1 → argv 含 --execute（授权真跑）', () => {
  const old = process.env.DCE_EXECUTE;
  process.env.DCE_EXECUTE = '1';
  try {
    const argv = STAGES.find((s) => s.name === 'dce')!.argv({ runDir: 'R', runId: 'I', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, 'R');
    assert.ok(argv.includes('--execute'));
    assert.ok(argv.includes('--start-date') && argv.includes('--operating-root'));   // A 案两参全
  } finally {
    if (old === undefined) delete process.env.DCE_EXECUTE;
    else process.env.DCE_EXECUTE = old;
  }
});

test('c3 双修 B：gateStageResult inner score.verdict 优先（inner fail + 顶层 pass → 拒）', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'c3-gate-'));
  writeFileSync(path.join(d, 'score.json'),
    JSON.stringify({ verdict: 'pass', score: { verdict: 'fail' } }), 'utf8');
  const g = gateStageResult({ name: 'score', output: 'score.json' }, d);
  assert.equal(g.ok, false);                       // inner 优先
  assert.match(String(g.detail), /inner/);
});

test('c3 双修 B：inner pass + 顶层 fail → 放行（inner 优先·旧件兼容回落）', () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'c3-gate2-'));
  writeFileSync(path.join(d, 'score.json'),
    JSON.stringify({ verdict: 'fail', score: { verdict: 'pass' } }), 'utf8');
  assert.equal(gateStageResult({ name: 'score', output: 'score.json' }, d).ok, true);
  // 旧件形（无 score 嵌层）回落顶层
  const d2 = mkdtempSync(path.join(os.tmpdir(), 'c3-gate3-'));
  writeFileSync(path.join(d2, 'score.json'), JSON.stringify({ verdict: 'fail' }), 'utf8');
  assert.equal(gateStageResult({ name: 'score', output: 'score.json' }, d2).ok, false);
});


test('v8 item4：close run_state=partial（七席未齐）→ 止链不发 notify_done', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-item4-'));
  const b = greenBehavior(runDir);
  b.close_skill = { write: path.join(runDir, 'close.json'), body: '{"run_state":"partial"}' };
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 'i4', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.equal(r.ok, false);
  assert.equal(r.failed_stage, 'close_skill');
  assert.match(String(r.err), /不发 notify_done/);
  assert.ok(!existsSync(path.join(runDir, 'notify_done.json')));   // notify 不触
});


test('v8 run_state 权威化：seven_seats.ok=true 时席自判 partial 不停链（辅防）', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-auth-'));
  const b = greenBehavior(runDir);
  b.close_skill = { write: path.join(runDir, 'close.json'),
    body: '{"run_state":"partial","seven_seats":{"ok":true}}' };
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 'auth', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.ok(!(r.failed_stage === 'close_skill'), 'seven_seats.ok=>不停链');
});


test('T2b：chain journal 落卷（chain_start/阶段/chain_end + D-91 marker 痕）', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-t2b-'));
  const b = greenBehavior(runDir);
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 't2b', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.equal(r.ok, true);
  const jp = path.join(runDir, 'chain-journal.jsonl');
  assert.ok(existsSync(jp));
  const lines = readFileSync(jp, 'utf8').trim().split(String.fromCharCode(10)).map((x) => JSON.parse(x));
  const events = lines.map((x) => x.event);
  assert.ok(events.includes('chain_start'));
  assert.ok(events.includes('stage_ok'));
  assert.ok(events.includes('chain_end'));
  const st = lines.find((x) => x.event === 'chain_start');
  assert.ok(st.d91_marker);                       // D-91 禁推 marker 痕（absent/unknown 记录）
  const end = lines.find((x) => x.event === 'chain_end');
  assert.equal(end.ok, true);
});

test('T2b：close partial 止链 → journal chain_end ok=false（failed_stage=close_skill）', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-t2b2-'));
  const b = greenBehavior(runDir);
  b.close_skill = { write: path.join(runDir, 'close.json'), body: '{"run_state":"partial"}' };
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 't2b2', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.equal(r.ok, false);
  const lines = readFileSync(path.join(runDir, 'chain-journal.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map((x) => JSON.parse(x));
  const end = lines.find((x) => x.event === 'chain_end');
  assert.equal(end.ok, false);
  assert.equal(end.failed_stage, 'close_skill');
});


test('S4a：close_skill rc=2（红面即停）→ 链止于 close_skill', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-s4a-'));
  const b = greenBehavior(runDir);
  b.close_skill = { write: path.join(runDir, 'close.json'), body: '{}', rc: 2 };
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 's4a', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.equal(r.ok, false);
  const err = String(r.err);
  assert.match(err, /close_skill/);
  assert.ok(!existsSync(path.join(runDir, 'notify_done.json')));
});

test('charter 1/2/5 段门：dce 非 pass（rc0·dry_run_not_executed）→止链·failed_stage=dce·不 notify', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-gate-'));
  const b = greenBehavior(runDir);
  b.dce = { write: path.join(runDir, 'dce.json'), body: '{"verdict":"dry_run_not_executed"}' };
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 'g1', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.equal(r.ok, false);
  assert.equal(r.failed_stage, 'dce');                       // ②failed_stage 可诊断
  assert.match(String(r.err), /门拒（非 pass 止链·不 notify）/);
  assert.ok(!runner.stagesRun.includes('verify'));           // ①禁穿门到段 5+
  assert.ok(!existsSync(path.join(runDir, 'notify_done.json')));   // ②notify 不触
});

test('charter 1/2/5 段门：dce verdict=fail（rc0）同止链', async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-gate2-'));
  const b = greenBehavior(runDir);
  b.dce = { write: path.join(runDir, 'dce.json'), body: '{"verdict":"fail"}' };
  const tc = stubAll(b);
  const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
  const r = await runner.run({ runDir, runId: 'g2', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
  assert.equal(r.ok, false);
  assert.equal(r.failed_stage, 'dce');
});

test('charter 1/2/5 回退锚：FADE_CHAIN_GATE_STRICT=0 → 旧形续链', async () => {
  const old = process.env.FADE_CHAIN_GATE_STRICT;
  process.env.FADE_CHAIN_GATE_STRICT = '0';
  try {
    const runDir = mkdtempSync(path.join(os.tmpdir(), 'd7-gate3-'));
    const b = greenBehavior(runDir);
    b.dce = { write: path.join(runDir, 'dce.json'), body: '{"verdict":"dry_run_not_executed"}' };
    const tc = stubAll(b);
    const runner = makeChainRunner({ triCompanyRoot: tc, pythonBin: PY });
    const r = await runner.run({ runDir, runId: 'g3', fromWeek: 'W1', toWeek: 'W2', startDate: '2026-01-05', tmvRoot: 'T' } as never, null);
    assert.equal(r.ok, true);                                // 旧形：门不拦
    assert.ok(runner.stagesRun.includes('verify'));
  } finally {
    if (old === undefined) delete process.env.FADE_CHAIN_GATE_STRICT;
    else process.env.FADE_CHAIN_GATE_STRICT = old;
  }
});

test('CS-13 spawn 窗对表随行项：SPAWN_STAGE_TIMEOUT_MS=7_200_000（7×900s+15min 余量（CTO 2026-11-21 上调））·段 7 覆写形在位·余段缺省', () => {
  assert.equal(SPAWN_STAGE_TIMEOUT_MS, 7_200_000);   // 7 席×900s+开销余量（COO 释放令条款③勘定值面）
  const spawnSeg = STAGES.find((s) => s.name === 'score_skill');
  assert.equal(spawnSeg?.timeoutMs, SPAWN_STAGE_TIMEOUT_MS);
  const overridden = STAGES.filter((s) => s.timeoutMs !== undefined);
  // DP-20261123-019：段 3 超时预算覆写（300s 快失败）+段 7 spawn 窗——两段覆写
  assert.deepEqual(overridden.map((s) => s.name), ['plan_scope', 'score_skill']);
  assert.equal(STAGES.find((s) => s.name === 'plan_scope')?.timeoutMs, 480_000);   // 段 3=480s（COO 16:43 三调）
});
