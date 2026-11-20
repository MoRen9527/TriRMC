// ── FADE-001 D7 节 4·chain_runner 白盒案族 ──
// 施工纪律：stub python 形零真实 CLI 零真实 7 席 spawn 零真实迁移（GLM 轨单跑·施工期白盒
// 一律 mock 形——D2 令 2 风险面承录）——stubAll 铸临时 TC 检出根+per-test 专属 stub 脚本集。
// 案族照 D1 §四装配正形+round_runner 白盒先例形（node:test·.js 后缀 import）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { STAGES, makeChainRunner } from '../../src/fade001/chain_runner.js';

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

test('CS-4 rc=2 fail 投影：err 含段名+rc+stderr 尾·零续段', async () => {
  const { root, runDir } = makeEnv();
  try {
    const b = greenBehavior(runDir);
    b.qualify = { rc: 2, stderr: 'boom: no repo' };
    const r = runnerFor(stubAll(b));
    const out = await r.run(params(runDir), null);
    assert.equal(out.ok, false);
    assert.match(String(out.err), /段 2\(qualify\) rc=2/);
    assert.match(String(out.err), /boom: no repo/);
    assert.deepEqual(r.stagesRun, ['preflight', 'qualify']);
  } finally { cleanup(root); }
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
