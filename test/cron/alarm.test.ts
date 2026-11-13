/**
 * alarm tests — FADE-001 要点③告警闸单测。
 *
 * 覆盖（对表 TriMLC power-monitor 11-12 窗专测双案同款）：
 *   - 判定矩阵：missed-run grace 边界/在跑豁免/已跑豁免/one-shot 豁免/disabled；
 *     failed-run 窗口边界/成功翻态；missed 优先序。
 *   - arrival-missing（阶段 2·F2 到岗窗断言）：超窗判定/35min 边界/touch 豁免/
 *     五豁免族（在跑/没跑过/disabled/探失败/无 run 目录）/优先序兜底/
 *     probeArrivalFace IO 探（字典序最新 shift-* + arrival.json 存在性）/
 *     tick 端到端（temp runsRoot 注入·runDirName 载荷/名单外零探针/missed 优先）。
 *   - 熔断电路双案：案 1（退避门——fire 后 armed=false 抑制·稳定窗 3 拍才重臂·
 *     重臂不清窗锚回归锚）；案 2（时间窗——dedup 窗内挡·窗过期放行）。
 *   - tick 环：端到端 fire→notifier 收件·第二拍不重发·loadJobs 抛错不炸环。
 *   - HTTP 辅形 notifier：POST 体形/2xx 过/非 2xx 抛。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { CronJob } from '@tricompany/agent-core';
import {
  ALARM_DEFAULTS,
  createCronAlarm,
  createHttpNotifier,
  deliverWithRetry,
  evaluateArrivalMissing,
  evaluateJob,
  newCircuit,
  probeArrivalFace,
  stepCircuit,
  eventSubject,
  eventText,
  type AlarmNotifier,
  type ArrivalFace,
  type CronAlarmEvent,
} from '../../src/cron/alarm.js';

const MIN = 60_000;

/** 造一个带 state 的测试 job（只填判定面用到的字段）。 */
function makeJob(overrides: {
  id?: string;
  name?: string;
  enabled?: boolean;
  nextRunAtMs?: number | null;
  runningAtMs?: number | null;
  lastRunAtMs?: number | null;
  lastRunStatus?: 'ok' | 'error' | null;
  consecutiveErrors?: number;
  lastError?: string | null;
  runCount?: number;
}): CronJob {
  return {
    id: overrides.id ?? 'job-1',
    name: overrides.name ?? 'weekly_plane_shift',
    enabled: overrides.enabled ?? true,
    schedule: { kind: 'cron', cron: '50 23 * * 0' },
    payload: {},
    staggerMs: 0,
    state: {
      nextRunAtMs: overrides.nextRunAtMs ?? null,
      runningAtMs: overrides.runningAtMs ?? null,
      lastRunAtMs: overrides.lastRunAtMs ?? null,
      lastRunStatus: overrides.lastRunStatus ?? null,
      lastError: overrides.lastError ?? null,
      consecutiveErrors: overrides.consecutiveErrors ?? 0,
      lastDurationMs: null,
      runCount: overrides.runCount ?? 14,
    },
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

const JUDGE = { graceMs: 30 * MIN, failWindowMs: 30 * MIN };
const GATE = { dedupMs: 30 * MIN, stableTicks: 3 };

describe('evaluateJob 判定矩阵', () => {
  const T0 = 1_800_000_000_000; // 虚拟现在

  it('漏拍：nextRun 已过 grace 且无新 run → missed-run', () => {
    const job = makeJob({
      nextRunAtMs: T0 - 31 * MIN, // 排程时点 31min 前
      lastRunAtMs: T0 - 8 * 24 * 60 * MIN, // 上次成功在很久以前（上一拍）
      lastRunStatus: 'ok',
    });
    assert.equal(evaluateJob(job, T0, JUDGE), 'missed-run');
  });

  it('漏拍边界：now 恰为 nextRun+grace → 不判（须严格大于）', () => {
    const next = T0 - 30 * MIN;
    const job = makeJob({ nextRunAtMs: next, lastRunAtMs: next - 7 * 24 * 60 * MIN, lastRunStatus: 'ok' });
    assert.equal(evaluateJob(job, next + JUDGE.graceMs, JUDGE), null);
  });

  it('漏拍：grace 内 → 不判', () => {
    const next = T0 - 10 * MIN;
    const job = makeJob({ nextRunAtMs: next, lastRunAtMs: next - 7 * 24 * 60 * MIN, lastRunStatus: 'ok' });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('漏拍豁免：正在跑（runningAtMs 非空）→ 不判', () => {
    const next = T0 - 31 * MIN;
    const job = makeJob({
      nextRunAtMs: next,
      lastRunAtMs: next - 7 * 24 * 60 * MIN,
      lastRunStatus: 'ok',
      runningAtMs: T0 - 5 * MIN,
    });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('漏拍豁免：已跑该拍（lastRun >= nextRun）→ 不判', () => {
    const next = T0 - 31 * MIN;
    const job = makeJob({
      nextRunAtMs: next,
      lastRunAtMs: next + 30_000, // 跑完写了 lastRun 并重算
      lastRunStatus: 'ok',
    });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('漏拍豁免：nextRunAtMs=null（one-shot 已完成）→ 不判', () => {
    const job = makeJob({ nextRunAtMs: null, lastRunAtMs: T0 - 60 * MIN, lastRunStatus: 'ok' });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('漏拍豁免：disabled job → 不判', () => {
    const next = T0 - 31 * MIN;
    const job = makeJob({ enabled: false, nextRunAtMs: next, lastRunAtMs: next - 7 * 24 * 60 * MIN, lastRunStatus: 'ok' });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('败跑：lastRunStatus=error 持续超窗 → failed-run', () => {
    const job = makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN, // 下拍在下周（不触漏拍）
      lastRunAtMs: T0 - 31 * MIN,
      lastRunStatus: 'error',
      consecutiveErrors: 2,
    });
    assert.equal(evaluateJob(job, T0, JUDGE), 'failed-run');
  });

  it('败跑边界：窗内 → 不判', () => {
    const job = makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN,
      lastRunAtMs: T0 - 10 * MIN,
      lastRunStatus: 'error',
    });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('败跑豁免：lastRunStatus=ok → 不判', () => {
    const job = makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN,
      lastRunAtMs: T0 - 31 * MIN,
      lastRunStatus: 'ok',
    });
    assert.equal(evaluateJob(job, T0, JUDGE), null);
  });

  it('优先序：漏拍+败跑并存 → 只报 missed-run', () => {
    const next = T0 - 31 * MIN;
    const job = makeJob({
      nextRunAtMs: next,
      lastRunAtMs: next - 7 * 24 * 60 * MIN,
      lastRunStatus: 'error', // 上一拍败了，本拍又没跑
      consecutiveErrors: 1,
    });
    assert.equal(evaluateJob(job, T0, JUDGE), 'missed-run');
  });
});

describe('arrival-missing 判定（阶段 2·F2 到岗窗断言·face 注入形）', () => {
  const T0 = 4_000_000_000_000;
  const JUDGE_A = { graceMs: 30 * MIN, failWindowMs: 30 * MIN, arrivalGraceMs: 35 * MIN };
  const face = (over: Partial<ArrivalFace> = {}): ArrivalFace => ({
    latestRunDirName: 'shift-WW46-20261113T065305Z',
    hasArrival: false,
    ...over,
  });

  /** 迁移 job 形：40min 前跑完一拍（超 35min 到岗窗）+下拍在下周（不触 missed）。 */
  function arrivalJob(overrides: Parameters<typeof makeJob>[0] = {}) {
    return makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN,
      lastRunAtMs: T0 - 40 * MIN,
      lastRunStatus: 'ok',
      ...overrides,
    });
  }

  it('超窗+无 arrival → arrival-missing', () => {
    assert.equal(evaluateJob(arrivalJob(), T0, JUDGE_A, face()), 'arrival-missing');
  });

  it('到岗窗内（<35min）→ 不判', () => {
    assert.equal(evaluateJob(arrivalJob({ lastRunAtMs: T0 - 34 * MIN }), T0, JUDGE_A, face()), null);
  });

  it('边界：now 恰为 lastRun+arrivalGrace → 不判（须严格大于）', () => {
    assert.equal(evaluateJob(arrivalJob({ lastRunAtMs: T0 - 35 * MIN }), T0, JUDGE_A, face()), null);
  });

  it('已 touch arrival.json → 不判（不误报方向）', () => {
    assert.equal(evaluateJob(arrivalJob(), T0, JUDGE_A, face({ hasArrival: true })), null);
  });

  it('豁免：正在跑 → 不判', () => {
    assert.equal(evaluateJob(arrivalJob({ runningAtMs: T0 - 2 * MIN }), T0, JUDGE_A, face()), null);
  });

  it('豁免：没跑过（lastRunAtMs=null）→ 不判', () => {
    assert.equal(evaluateJob(arrivalJob({ lastRunAtMs: null, lastRunStatus: null }), T0, JUDGE_A, face()), null);
  });

  it('豁免：disabled → 不判', () => {
    assert.equal(evaluateJob(arrivalJob({ enabled: false }), T0, JUDGE_A, face()), null);
  });

  it('豁免：探失败（unknown）→ 不判', () => {
    assert.equal(evaluateJob(arrivalJob(), T0, JUDGE_A, face({ unknown: true })), null);
  });

  it('豁免：无 run 目录（latestRunDirName=null）→ 不判', () => {
    assert.equal(evaluateJob(arrivalJob(), T0, JUDGE_A, face({ latestRunDirName: null })), null);
  });

  it('优先序：missed 与 arrival 并存 → 只报 missed-run', () => {
    const next = T0 - 31 * MIN;
    const job = arrivalJob({ nextRunAtMs: next, lastRunAtMs: next - 7 * 24 * 60 * MIN });
    assert.equal(evaluateJob(job, T0, JUDGE_A, face()), 'missed-run');
  });

  it('face 缺省（undefined）→ 第三分支不激活', () => {
    assert.equal(evaluateJob(arrivalJob(), T0, JUDGE_A), null);
  });

  it('evaluateArrivalMissing 直判与 evaluateJob 同判（纯函数对表）', () => {
    const job = arrivalJob();
    assert.equal(
      evaluateArrivalMissing(job, T0, { arrivalGraceMs: 35 * MIN }, face()),
      true,
    );
    assert.equal(
      evaluateArrivalMissing(job, T0, { arrivalGraceMs: 35 * MIN }, face({ hasArrival: true })),
      false,
    );
  });
});

describe('probeArrivalFace IO 探读（temp runsRoot）', () => {
  it('字典序最新 shift-* 目录 + arrival.json 存在性（非 shift 目录/文件不计）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'trirmc-alarm-probe-'));
    mkdirSync(path.join(root, 'shift-WW45-20261106T235000Z'), { recursive: true });
    mkdirSync(path.join(root, 'shift-WW46-20261113T065305Z'), { recursive: true });
    mkdirSync(path.join(root, 'other-dir'), { recursive: true });
    writeFileSync(path.join(root, 'shift-not-a-dir.txt'), 'x');
    const f1 = await probeArrivalFace(root);
    assert.equal(f1.unknown, undefined);
    assert.equal(f1.latestRunDirName, 'shift-WW46-20261113T065305Z');
    assert.equal(f1.hasArrival, false);
    writeFileSync(path.join(root, 'shift-WW46-20261113T065305Z', 'arrival.json'), '{"ts":1}');
    const f2 = await probeArrivalFace(root);
    assert.equal(f2.hasArrival, true);
    rmSync(root, { recursive: true, force: true });
  });

  it('runsRoot 不存在 → unknown（探失败族不判·豁免方向）', async () => {
    const f = await probeArrivalFace(path.join(tmpdir(), `no-such-runs-${Date.now()}`));
    assert.equal(f.unknown, true);
    assert.equal(f.latestRunDirName, null);
  });

  it('空 root（无 shift-* 目录）→ latestRunDirName=null 非 unknown', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'trirmc-alarm-empty-'));
    const f = await probeArrivalFace(root);
    assert.equal(f.unknown, undefined);
    assert.equal(f.latestRunDirName, null);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('stepCircuit 熔断电路（专测双案同款）', () => {
  const T0 = 2_000_000_000_000;

  it('案 1·退避门：fire 后 armed=false，持续失败期不再重复告警', () => {
    const c = newCircuit();
    assert.equal(stepCircuit(c, true, T0, GATE).fire, true);
    assert.equal(c.armed, false);
    assert.equal(c.lastAlarmAtMs, T0);
    // 失败持续：不重发
    for (let i = 1; i <= 10; i++) {
      assert.equal(stepCircuit(c, true, T0 + i * MIN, GATE).fire, false);
    }
  });

  it('案 1·稳定窗：恢复后连 3 拍健康才重臂（1-2 拍不够——短路回归锚）', () => {
    const c = newCircuit();
    stepCircuit(c, true, T0, GATE); // fire → armed=false
    assert.equal(stepCircuit(c, false, T0 + MIN, GATE).fire, false);
    assert.equal(c.armed, false); // 1 拍健康：未重臂
    assert.equal(stepCircuit(c, false, T0 + 2 * MIN, GATE).fire, false);
    assert.equal(c.armed, false); // 2 拍健康：仍未重臂
    // 第 2 拍后条件闪回真（未重臂）→ 不 fire
    assert.equal(stepCircuit(c, true, T0 + 2.5 * MIN, GATE).fire, false);
    assert.equal(c.okTicks, 0);
    // 再连 3 拍健康 → 重臂
    stepCircuit(c, false, T0 + 3 * MIN, GATE);
    stepCircuit(c, false, T0 + 4 * MIN, GATE);
    assert.equal(stepCircuit(c, false, T0 + 5 * MIN, GATE).fire, false);
    assert.equal(c.armed, true);
    // **复位不清窗锚**：重臂后窗锚保持 T0
    assert.equal(c.lastAlarmAtMs, T0);
  });

  it('案 2·时间窗：重臂后 dedup 窗内新失败被挡（窗锚不清的兑现面）', () => {
    const c = newCircuit();
    stepCircuit(c, true, T0, GATE); // fire，锚=T0
    // 立即恢复并连 3 拍重臂
    stepCircuit(c, false, T0 + MIN, GATE);
    stepCircuit(c, false, T0 + 2 * MIN, GATE);
    stepCircuit(c, false, T0 + 3 * MIN, GATE);
    assert.equal(c.armed, true);
    // 窗内（T0+10min < dedup 30min）新失败 → 挡
    assert.equal(stepCircuit(c, true, T0 + 10 * MIN, GATE).fire, false);
    // 窗过期（T0+31min >= dedup）新失败 → 放行
    assert.equal(stepCircuit(c, true, T0 + 31 * MIN, GATE).fire, true);
    assert.equal(c.lastAlarmAtMs, T0 + 31 * MIN); // 锚更新为新 fire
  });

  it('首次条件成真即 fire（armed 初始 true·窗锚 null）', () => {
    const c = newCircuit();
    assert.equal(stepCircuit(c, true, T0, GATE).fire, true);
  });
});

describe('createCronAlarm tick 环（虚拟钟+捕获 notifier）', () => {
  const T0 = 3_000_000_000_000;
  const OPTS = { graceMs: 30 * MIN, failWindowMs: 30 * MIN, dedupMs: 30 * MIN, stableTicks: 3 };

  function harness(jobs: CronJob[]) {
    let clock = T0;
    const received: CronAlarmEvent[] = [];
    const notifier: AlarmNotifier = {
      name: 'test-capture',
      async send(ev) {
        received.push(ev);
      },
    };
    const handle = createCronAlarm({
      notifiers: [notifier],
      loadJobs: async () => jobs,
      now: () => clock,
      retryDelaysMs: [1, 1, 1],
      log: () => {},
      ...OPTS,
    });
    return {
      handle,
      received,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  it('端到端：漏拍 job → 首拍 fire 收件 → 第二拍不重发', async () => {
    const next = T0 - 31 * MIN;
    const job = makeJob({ nextRunAtMs: next, lastRunAtMs: next - 7 * 24 * 60 * MIN, lastRunStatus: 'ok' });
    const h = harness([job]);

    await h.handle.tickOnce();
    assert.equal(h.received.length, 1);
    assert.equal(h.received[0].kind, 'missed-run');
    assert.equal(h.received[0].jobId, 'job-1');
    assert.equal(h.received[0].detail.runCount, 14);

    await h.handle.tickOnce(); // 同一失败态：熔断不重发
    assert.equal(h.received.length, 1);

    h.handle.stop();
  });

  it('健康 job → 零事件', async () => {
    const job = makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN,
      lastRunAtMs: T0 - 60 * MIN,
      lastRunStatus: 'ok',
    });
    const h = harness([job]);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 0);
    h.handle.stop();
  });

  it('loadJobs 抛错 → tick 存活（下一拍恢复判定）', async () => {
    let fail = true;
    const job = makeJob({
      nextRunAtMs: T0 - 31 * MIN,
      lastRunAtMs: T0 - 8 * 24 * 60 * MIN,
      lastRunStatus: 'ok',
    });
    const received: CronAlarmEvent[] = [];
    let clock = T0;
    const handle = createCronAlarm({
      notifiers: [{ name: 'cap', async send(ev) { received.push(ev); } }],
      loadJobs: async () => {
        if (fail) throw new Error('store boom');
        return [job];
      },
      now: () => clock,
      retryDelaysMs: [1, 1, 1],
      log: () => {},
      ...OPTS,
    });
    await handle.tickOnce(); // 抛错被吞
    assert.equal(received.length, 0);
    fail = false;
    clock += MIN;
    await handle.tickOnce(); // 恢复后正常判定
    assert.equal(received.length, 1);
    handle.stop();
  });

  it('败跑分支端到端：error 态超窗 → failed-run 事件', async () => {
    const job = makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN,
      lastRunAtMs: T0 - 31 * MIN,
      lastRunStatus: 'error',
      consecutiveErrors: 2,
      lastError: 'exit 128',
    });
    const h = harness([job]);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 1);
    assert.equal(h.received[0].kind, 'failed-run');
    assert.equal(h.received[0].detail.consecutiveErrors, 2);
    assert.equal(h.received[0].detail.lastError, 'exit 128');
    h.handle.stop();
  });
});

describe('createCronAlarm arrival-missing tick 环（temp runsRoot 注入）', () => {
  const T0 = 4_500_000_000_000;
  const OPTS_A = {
    graceMs: 30 * MIN,
    failWindowMs: 30 * MIN,
    dedupMs: 30 * MIN,
    stableTicks: 3,
    arrivalGraceMs: 35 * MIN,
  };

  function harnessWithRoot(jobs: CronJob[], runsRoot: string) {
    let clock = T0;
    const received: CronAlarmEvent[] = [];
    const handle = createCronAlarm({
      notifiers: [{ name: 'cap', async send(ev) { received.push(ev); } }],
      loadJobs: async () => jobs,
      now: () => clock,
      retryDelaysMs: [1, 1, 1],
      log: () => {},
      runsRoot,
      ...OPTS_A,
    });
    return {
      handle,
      received,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  function tempRunsRoot(withArrival: boolean): string {
    const root = mkdtempSync(path.join(tmpdir(), 'trirmc-alarm-runs-'));
    const runDir = path.join(root, 'shift-WW46-20261113T065305Z');
    mkdirSync(runDir, { recursive: true });
    if (withArrival) writeFileSync(path.join(runDir, 'arrival.json'), '{"ts":"x"}');
    return root;
  }

  function cleanupRoot(root: string) {
    rmSync(root, { recursive: true, force: true });
  }

  function arrivalTickJob(overrides: Parameters<typeof makeJob>[0] = {}) {
    return makeJob({
      nextRunAtMs: T0 + 6 * 24 * 60 * MIN,
      lastRunAtMs: T0 - 40 * MIN,
      lastRunStatus: 'ok',
      ...overrides,
    });
  }

  it('端到端：超窗+无 arrival → fire arrival-missing + runDirName 载目录名 + 熔断不重发', async () => {
    const root = tempRunsRoot(false);
    const h = harnessWithRoot([arrivalTickJob()], root);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 1);
    assert.equal(h.received[0].kind, 'arrival-missing');
    assert.equal(h.received[0].detail.runDirName, 'shift-WW46-20261113T065305Z');
    await h.handle.tickOnce();
    assert.equal(h.received.length, 1); // 同一失败态：熔断不重发
    cleanupRoot(root);
    h.handle.stop();
  });

  it('已 touch arrival → 零事件（不误报）', async () => {
    const root = tempRunsRoot(true);
    const h = harnessWithRoot([arrivalTickJob()], root);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 0);
    cleanupRoot(root);
    h.handle.stop();
  });

  it('名单外 job（name 不匹配）→ 零探针零事件', async () => {
    const root = tempRunsRoot(false);
    const h = harnessWithRoot([arrivalTickJob({ name: 'other-job' })], root);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 0);
    cleanupRoot(root);
    h.handle.stop();
  });

  it('runsRoot 不存在 → unknown 豁免零事件', async () => {
    const h = harnessWithRoot([arrivalTickJob()], path.join(tmpdir(), `no-such-runs-${Date.now()}`));
    await h.handle.tickOnce();
    assert.equal(h.received.length, 0);
    h.handle.stop();
  });

  it('missed 与 arrival 并存 → 只报 missed-run（arrival 被豁免·零 arrival 投影）', async () => {
    const root = tempRunsRoot(false);
    const next = T0 - 31 * MIN;
    const job = arrivalTickJob({ nextRunAtMs: next, lastRunAtMs: next - 7 * 24 * 60 * MIN });
    const h = harnessWithRoot([job], root);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 1);
    assert.equal(h.received[0].kind, 'missed-run');
    assert.equal(h.received[0].detail.runDirName, undefined);
    cleanupRoot(root);
    h.handle.stop();
  });

  it('arrival 事件投影零 payload/command 回显（D-46 同族）', async () => {
    const root = tempRunsRoot(false);
    const job = arrivalTickJob();
    (job.payload as Record<string, unknown>).command = 'echo SECRET-ARRIVAL-FACE';
    const h = harnessWithRoot([job], root);
    await h.handle.tickOnce();
    assert.equal(h.received.length, 1);
    const text = eventText(h.received[0]);
    assert.ok(!text.includes('SECRET-ARRIVAL-FACE'));
    assert.ok(!text.includes('command'));
    assert.ok(text.includes('runDirName: shift-WW46-20261113T065305Z'));
    cleanupRoot(root);
    h.handle.stop();
  });
});

describe('HTTP 辅形 notifier', () => {
  const T0 = 3_500_000_000_000;

  it('POST 体形正确 + 2xx 放行', async () => {
    const bodies: string[] = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        bodies.push(data);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as net.AddressInfo;
    const n = createHttpNotifier({ url: `http://127.0.0.1:${addr.port}/notify`, token: 'secret-token-x' });
    const ev: CronAlarmEvent = {
      jobId: 'j1',
      jobName: 'weekly_plane_shift',
      kind: 'missed-run',
      detectedAtMs: T0,
      detail: {
        nextRunAtMs: null,
        lastRunAtMs: null,
        lastRunStatus: null,
        consecutiveErrors: 0,
        lastError: null,
        runCount: 0,
      },
    };
    await n.send(ev);
    assert.equal(bodies.length, 1);
    const parsed = JSON.parse(bodies[0]) as { source: string; event: CronAlarmEvent };
    assert.equal(parsed.source, 'trirmc-cron-alarm');
    assert.equal(parsed.event.kind, 'missed-run');
    server.close();
    server.closeAllConnections(); // undici keep-alive 连接不拖事件循环（否则 test 子进程不退出）
  });

  it('非 2xx → 抛错（退避层接手）', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(503);
      res.end('unavailable');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as net.AddressInfo;
    const n = createHttpNotifier({ url: `http://127.0.0.1:${addr.port}/notify`, timeoutMs: 2_000 });
    await assert.rejects(
      () => n.send({ jobId: 'j', jobName: 'n', kind: 'failed-run', detectedAtMs: 0, detail: { nextRunAtMs: null, lastRunAtMs: null, lastRunStatus: null, consecutiveErrors: 0, lastError: null, runCount: 0 } }),
      /503/,
    );
    server.close();
    server.closeAllConnections();
  });
});

describe('deliverWithRetry 退避', () => {
  it('3 次退避后放弃且不抛（全败只计 attempts）', async () => {
    let calls = 0;
    const failing: AlarmNotifier = {
      name: 'always-fail',
      async send() {
        calls++;
        throw new Error('down');
      },
    };
    const logs: string[] = [];
    await deliverWithRetry(failing, { jobId: 'j', jobName: 'n', kind: 'missed-run', detectedAtMs: 0, detail: { nextRunAtMs: null, lastRunAtMs: null, lastRunStatus: null, consecutiveErrors: 0, lastError: null, runCount: 0 } }, [1, 1, 1], (m) => logs.push(m));
    assert.equal(calls, 4); // 首发 + 3 退避
    assert.ok(logs.some((l) => l.includes('FAILED after 4')));
  });

  it('首次成功零重试', async () => {
    let calls = 0;
    const ok: AlarmNotifier = {
      name: 'ok',
      async send() {
        calls++;
      },
    };
    await deliverWithRetry(ok, { jobId: 'j', jobName: 'n', kind: 'missed-run', detectedAtMs: 0, detail: { nextRunAtMs: null, lastRunAtMs: null, lastRunStatus: null, consecutiveErrors: 0, lastError: null, runCount: 0 } }, [1, 1, 1], () => {});
    assert.equal(calls, 1);
  });
});

describe('N 值表终定值对表（验收锚③同值同源）', () => {
  it('defaults = grace/败跑窗/dedup 30min·稳定窗 3 拍·退避 1/5/25s·tick 60s', () => {
    assert.equal(ALARM_DEFAULTS.graceMs, 30 * MIN);
    assert.equal(ALARM_DEFAULTS.failWindowMs, 30 * MIN);
    assert.equal(ALARM_DEFAULTS.dedupMs, 30 * MIN);
    assert.equal(ALARM_DEFAULTS.stableTicks, 3);
    assert.deepEqual([...ALARM_DEFAULTS.retryDelaysMs], [1_000, 5_000, 25_000]);
    assert.equal(ALARM_DEFAULTS.tickMs, 60_000);
    assert.equal(ALARM_DEFAULTS.arrivalGraceMs, 35 * MIN);
    assert.deepEqual([...ALARM_DEFAULTS.arrivalJobNames], ['weekly_plane_shift']);
    assert.equal(ALARM_DEFAULTS.runsRoot, '/var/lib/trirmc/cron/runs');
  });

  it('事件投影零 payload/command 回显（D-46）', () => {
    const job = makeJob({ name: 'weekly_plane_shift' });
    (job.payload as Record<string, unknown>).command = 'echo SECRET-VALUE-FACE';
    const ev = { jobId: job.id, jobName: job.name, kind: 'missed-run' as const, detectedAtMs: 0, detail: { nextRunAtMs: null, lastRunAtMs: null, lastRunStatus: null, consecutiveErrors: 0, lastError: null, runCount: 0 } };
    const text = eventText(ev);
    const subject = eventSubject(ev);
    assert.ok(!text.includes('SECRET-VALUE-FACE'));
    assert.ok(!text.includes('command'));
    assert.ok(!subject.includes('SECRET-VALUE-FACE'));
  });
});
