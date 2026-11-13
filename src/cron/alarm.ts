/**
 * Cron alarm gate — FADE-001 第一阶段·要点③（job 级触发告警闸）。
 *
 * 设计边界（cto-phase1-tech-plan.md §三 终裁 + synthesis.md §二2）：
 *   - 挂点：TriRMC daemon 内 alarm 模块，独立 timer 读 job-store 判定，
 *     与 job-executor 平行，不侵入执行循环（零 executor 改动）。
 *   - 两条判据（CPO 防蠕变条款：不做分级/路由/聚合）：
 *     a) missed-run 漏拍：now > nextRunAtMs + grace 且无新 run 记录且不在跑。
 *     b) failed-run 败跑：lastRunStatus = error 持续 failWindow 无成功。
 *   - N 值表（终定，TriMLC power-monitor 11-12 窗先例同构）：
 *     grace=30min / 败跑窗=30min / dedup 时间窗=30min / 稳定窗=连续 3 拍成功重臂 /
 *     复位不清窗锚（稳定窗重臂不清 lastAlarmAtMs——11-12 窗自查勘定修正的回归锚）。
 *   - 优先序：missed-run 优先于 failed-run（漏拍=更重形态；败跑信息随 event.detail
 *     携带，单 job 单 tick 至多一条告警，防双告警噪声）。
 *   - 外发通道：notifier 注入形（SMTP 主形见 alarm-smtp.ts / HTTP 8712 辅形见
 *     createHttpNotifier），自带 3 次退避（1s/5s/25s），不依赖 ζ 验证结果。
 *   - 已知边界（如实挂账）：daemon 全死形态本闸同死——外部探针留后续阶段
 *     （值席 patrol 兜底=G3 最后防线）。
 *
 * 判定语义细节：
 *   - missed-run 的「无新 run 记录」判据：lastRunAtMs >= nextRunAtMs 视为该拍已跑
 *     （executor 跑完会写 lastRunAtMs 并重算 nextRunAtMs）；runningAtMs != null
 *     视为正在跑，不判漏拍（executor 中途死进程由 daemon 重启 stale-run 恢复复位）。
 *   - nextRunAtMs = null（one-shot 已完成或未排程）不判漏拍。
 *   - dedup 熔断：fire 时 armed=false + 记窗锚；持续失败期不再重复告警
 *     （一次发现语义，重复轰炸=告警疲劳反模式）；恢复后连 stableTicks 拍健康才重臂；
 *     重臂后新失败仍受 dedup 窗锚约束（复位不清窗锚）。
 */

import type { CronJob } from '@tricompany/agent-core';
import { loadJobStore } from '@tricompany/agent-core';

// ── N 值表（终定常量·部署面不改） ─────────────────────────────────

export const ALARM_DEFAULTS = {
  /** 判定 tick 周期（60s：条件成真后至多一个 tick 内告警） */
  tickMs: 60_000,
  /** 漏拍 grace（N 值表终定 30min·覆盖 23:50-00:20 到岗窗语义） */
  graceMs: 30 * 60_000,
  /** 败跑窗（N 值表终定 30min） */
  failWindowMs: 30 * 60_000,
  /** dedup 时间窗（N 值表终定 30min·窗内至多 1 条） */
  dedupMs: 30 * 60_000,
  /** 稳定窗：连续 3 拍健康才重臂（TriMLC 先例同值） */
  stableTicks: 3,
  /** 外发退避（自带 3 次退避·不依赖 ζ 验证结果） */
  retryDelaysMs: [1_000, 5_000, 25_000],
} as const;

// ── 判定纯函数 ──────────────────────────────────────────────────

export type CronAlarmKind = 'missed-run' | 'failed-run';

export interface AlarmJudgeParams {
  graceMs: number;
  failWindowMs: number;
}

/** 漏拍判据：排程时点已过 grace 且无新 run 记录且不在跑。 */
export function evaluateMissedRun(
  job: CronJob,
  nowMs: number,
  params: Pick<AlarmJudgeParams, 'graceMs'>,
): boolean {
  if (!job.enabled) return false;
  const st = job.state;
  if (st.nextRunAtMs === null) return false; // one-shot 已完成/未排程不判
  if (nowMs <= st.nextRunAtMs + params.graceMs) return false;
  if (st.runningAtMs !== null) return false; // 正在跑 = 拍了
  // 无新 run 记录：executor 跑完该拍会写 lastRunAtMs >= nextRunAtMs
  if (st.lastRunAtMs !== null && st.lastRunAtMs >= st.nextRunAtMs) return false;
  return true;
}

/** 败跑判据：lastRunStatus=error 持续 failWindow 无成功（后继成功会翻 lastRunStatus）。 */
export function evaluateFailedRun(
  job: CronJob,
  nowMs: number,
  params: Pick<AlarmJudgeParams, 'failWindowMs'>,
): boolean {
  if (!job.enabled) return false;
  const st = job.state;
  if (st.lastRunStatus !== 'error' || st.lastRunAtMs === null) return false;
  return nowMs > st.lastRunAtMs + params.failWindowMs;
}

/** 单 job 判定入口：missed-run 优先（单 tick 单 job 至多一条告警）。 */
export function evaluateJob(
  job: CronJob,
  nowMs: number,
  params: AlarmJudgeParams,
): CronAlarmKind | null {
  if (evaluateMissedRun(job, nowMs, params)) return 'missed-run';
  if (evaluateFailedRun(job, nowMs, params)) return 'failed-run';
  return null;
}

// ── dedup 熔断电路（TriMLC power-monitor 11-12 窗先例同构） ─────────

export interface AlarmCircuit {
  /** 重臂标志：fire 后 false；连续 stableTicks 拍健康后 true */
  armed: boolean;
  /** 连续健康拍计数（条件为真即清零） */
  okTicks: number;
  /** dedup 窗锚：上次 fire 时刻（复位不清窗锚——重臂不清此值） */
  lastAlarmAtMs: number | null;
}

export interface AlarmGateParams {
  dedupMs: number;
  stableTicks: number;
}

export function newCircuit(): AlarmCircuit {
  return { armed: true, okTicks: 0, lastAlarmAtMs: null };
}

/**
 * 熔断电路单步推进（原地更新 circuit，返回本拍是否应 fire）。
 *
 * 回归锚（TriMLC 11-12 窗病灶「稳定窗短路时间窗」）：
 *   重臂只置 armed=true，绝不清 lastAlarmAtMs——重臂后新失败仍受 dedup 窗锚约束。
 */
export function stepCircuit(
  c: AlarmCircuit,
  condition: boolean,
  nowMs: number,
  params: AlarmGateParams,
): { fire: boolean } {
  if (condition) {
    c.okTicks = 0;
    const windowOk =
      c.lastAlarmAtMs === null || nowMs - c.lastAlarmAtMs >= params.dedupMs;
    if (c.armed && windowOk) {
      c.armed = false;
      c.lastAlarmAtMs = nowMs;
      return { fire: true };
    }
    return { fire: false };
  }
  c.okTicks += 1;
  if (c.okTicks >= params.stableTicks) c.armed = true; // 重臂·不清窗锚
  return { fire: false };
}

// ── 告警事件与 notifier ────────────────────────────────────────

export interface CronAlarmEvent {
  jobId: string;
  jobName: string;
  kind: CronAlarmKind;
  detectedAtMs: number;
  detail: {
    nextRunAtMs: number | null;
    lastRunAtMs: number | null;
    lastRunStatus: string | null;
    consecutiveErrors: number;
    lastError: string | null;
    runCount: number;
  };
}

export interface AlarmNotifier {
  /** 通道名（进日志；禁含凭据值面——D-46） */
  readonly name: string;
  send(event: CronAlarmEvent): Promise<void>;
}

export function buildEvent(job: CronJob, kind: CronAlarmKind, detectedAtMs: number): CronAlarmEvent {
  const st = job.state;
  return {
    jobId: job.id,
    jobName: job.name,
    kind,
    detectedAtMs,
    detail: {
      nextRunAtMs: st.nextRunAtMs,
      lastRunAtMs: st.lastRunAtMs,
      lastRunStatus: st.lastRunStatus,
      consecutiveErrors: st.consecutiveErrors,
      lastError: st.lastError,
      runCount: st.runCount,
    },
  };
}

/** 纯文本投影（SMTP 用·无 payload/command 回显——D-46 零回显纪律）。 */
export function eventSubject(ev: CronAlarmEvent): string {
  return `[TriRMC cron alarm] ${ev.kind} — job "${ev.jobName}" (${ev.jobId})`;
}

export function eventText(ev: CronAlarmEvent): string {
  const d = ev.detail;
  return [
    `kind: ${ev.kind}`,
    `job: ${ev.jobName} (${ev.jobId})`,
    `detectedAtMs: ${ev.detectedAtMs}`,
    `nextRunAtMs: ${d.nextRunAtMs}`,
    `lastRunAtMs: ${d.lastRunAtMs}`,
    `lastRunStatus: ${d.lastRunStatus}`,
    `consecutiveErrors: ${d.consecutiveErrors}`,
    `lastError: ${d.lastError}`,
    `runCount: ${d.runCount}`,
  ].join('\n');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 通道自带 3 次退避（1s/5s/25s 终定）·全败只记日志不抛（fire 语义不受投递面阻塞）。 */
export async function deliverWithRetry(
  notifier: AlarmNotifier,
  event: CronAlarmEvent,
  retryDelaysMs: number[],
  log: (msg: string) => void,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await notifier.send(event);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= retryDelaysMs.length) {
        log(
          `[cron-alarm] notify FAILED after ${attempt + 1} attempts via ${notifier.name}: ${msg}`,
        );
        return;
      }
      log(`[cron-alarm] notify retry ${attempt + 1}/${retryDelaysMs.length} via ${notifier.name}: ${msg}`);
      await sleep(retryDelaysMs[attempt]);
    }
  }
}

// ── HTTP 辅形 notifier（TriMMC 8712 NOTIFY 辅位·端点实位施工窗活体勘） ──

export interface HttpNotifierOptions {
  url: string;
  /** 鉴权 token（Bearer·值面零回显——D-46） */
  token?: string;
  timeoutMs?: number;
}

export function createHttpNotifier(options: HttpNotifierOptions): AlarmNotifier {
  const name = `http:${options.url}`;
  return {
    name,
    async send(event: CronAlarmEvent): Promise<void> {
      const res = await fetch(options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({ source: 'trirmc-cron-alarm', event }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        throw new Error(`http notifier got ${res.status}`);
      }
    },
  };
}

// ── 主循环（独立 timer·与 job-executor 平行） ────────────────────

export interface CronAlarmOptions {
  notifiers: AlarmNotifier[];
  /** 缺省=agent-core loadJobStore 全量 enabled 扫描 */
  loadJobs?: () => Promise<CronJob[]>;
  /** 缺省=Date.now（测试注入虚拟钟） */
  now?: () => number;
  tickMs?: number;
  graceMs?: number;
  failWindowMs?: number;
  dedupMs?: number;
  stableTicks?: number;
  retryDelaysMs?: number[];
  log?: (msg: string) => void;
  /** 实例标签（多实例日志区分用） */
  label?: string;
}

export interface CronAlarmHandle {
  start(): void;
  stop(): void;
  /** 手动推进一拍（测试/人工探针用——start 不依赖此路径） */
  tickOnce(): Promise<void>;
}

export function createCronAlarm(options: CronAlarmOptions): CronAlarmHandle {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const tag = options.label ? `[cron-alarm:${options.label}]` : '[cron-alarm]';
  const now = options.now ?? (() => Date.now());
  const loadJobs =
    options.loadJobs ?? (async () => Object.values(await loadJobStore()));
  const judge: AlarmJudgeParams = {
    graceMs: options.graceMs ?? ALARM_DEFAULTS.graceMs,
    failWindowMs: options.failWindowMs ?? ALARM_DEFAULTS.failWindowMs,
  };
  const gate: AlarmGateParams = {
    dedupMs: options.dedupMs ?? ALARM_DEFAULTS.dedupMs,
    stableTicks: options.stableTicks ?? ALARM_DEFAULTS.stableTicks,
  };
  const retryDelaysMs = options.retryDelaysMs ?? [...ALARM_DEFAULTS.retryDelaysMs];
  const tickMs = options.tickMs ?? ALARM_DEFAULTS.tickMs;

  const circuits = new Map<string, AlarmCircuit>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function circuitFor(key: string): AlarmCircuit {
    let c = circuits.get(key);
    if (!c) {
      c = newCircuit();
      circuits.set(key, c);
    }
    return c;
  }

  async function tick(): Promise<void> {
    let jobs: CronJob[];
    try {
      jobs = await loadJobs();
    } catch (err: unknown) {
      log(`${tag} loadJobs failed (skip tick): ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const nowMs = now();
    for (const job of jobs) {
      const missed = evaluateMissedRun(job, nowMs, judge);
      const failed = missed ? false : evaluateFailedRun(job, nowMs, judge);
      // missed-run 优先：败跑电路随健康步进（信息已随 missed event.detail 携带）
      const kind: CronAlarmKind | null = missed ? 'missed-run' : failed ? 'failed-run' : null;

      const missedCircuit = circuitFor(`${job.id}:missed-run`);
      const failedCircuit = circuitFor(`${job.id}:failed-run`);
      const failedVerdict = stepCircuit(failedCircuit, failed, nowMs, gate);
      const missedVerdict = stepCircuit(missedCircuit, missed, nowMs, gate);
      if (missedVerdict.fire || failedVerdict.fire) {
        const firedKind: CronAlarmKind = missedVerdict.fire ? 'missed-run' : 'failed-run';
        const ev = buildEvent(job, firedKind, nowMs);
        log(
          `${tag} ALARM ${firedKind} job "${job.name}" (${job.id}) runCount=${job.state.runCount}`,
        );
        // 窗锚已置（fire 语义）；投递 best-effort——通道全败不回滚窗锚
        await Promise.all(
          options.notifiers.map((n) => deliverWithRetry(n, ev, retryDelaysMs, log)),
        );
      }
    }
  }

  return {
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (ticking) return; // 上一拍投递未完，跳过本拍（下拍追平）
        ticking = true;
        void tick()
          .catch((err: unknown) => {
            log(`${tag} tick error: ${err instanceof Error ? err.message : String(err)}`);
          })
          .finally(() => {
            ticking = false;
          });
      }, tickMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    async tickOnce(): Promise<void> {
      await tick();
    },
  };
}
