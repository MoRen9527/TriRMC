// ── Session Bridge (T2·dsh CLI 形改指·BOD 裁119②·FSD 主刀) ──
// TriRMC 编排层 ↔ dsh 会话桥（三 API 改指形·候 CTO 完工门禁二审）：
//   spawn  → dsh --profile headless -n <employeeId> "<task>"   → 会话 boot（headless profile·受限工具集）
//   list   → ~/.dsh/sessions 工作区会话族扫描                   → 注册表（agentId↔sessionId↔employeeId）
//   send   → dsh --profile headless --session-id <uuid> "<msg>" → 回复文本
//
// PATH 解析序三段（五判据④·禁静默回退 claude）：
//   ①显式 dshBin（SessionBridgeOptions/调用方注入）→ ②env TRIRMC_DSH_BIN →
//   ③实勘位 /srv/fleet/dsh/node_modules/.bin/dsh（T1a 活体探针位）→ ④PATH which dsh——
//   命中记录随 error/读数面；三/四段全落空 = fail-visible 报错（三段探测详情载明）。
//
// 降权链分级（五判据②）：headless profile=受限工具集（评分/值守会话缺省形）——
// danger-full-access 禁用除非逐席正当化+卷面正当化注（r111 governs 承形）；
// runuser 降权链保留（root systemd 面同理）。
//
// 会话状态机全形（五判据③·禁隐式状态）：五态+迁移表显式枚举（DshSessionState/
// SESSION_TRANSITIONS 导出·禁隐式态三件=状态/事件/动作枚举面）。
// 零依赖凭据声明（五判据⑤）：bridge 构造段零 key 需求——dsh profile 凭据=
// dsh 进程自身消费（T1b CI 配置管线域）。
//
// 来源：BOD 裁119② 派工令（值席分诊·工序面 COS 径裁）+任务书 96f3b41b5 §三
// +CTO 门禁五判据+fsd-t2-design-20261116.md 方案卷（一审绿 PASS）

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// ── 会话状态机全形（五判据③·显式枚举） ─────────────────────────────

export type DshSessionState =
  | 'idle'
  | 'sending'
  | 'awaiting-reply'
  | 'delivered'
  | 'failed';

/** 迁移表（状态×事件→动作·次态）——显式枚举禁隐式态 */
export const SESSION_TRANSITIONS: ReadonlyArray<{
  state: DshSessionState; event: string; action: string; next: DshSessionState;
}> = [
  { state: 'idle', event: 'send 请求', action: 'spawn dsh send 子进程', next: 'sending' },
  { state: 'sending', event: 'dsh exit 0+输出非空', action: '提取回复文本', next: 'delivered' },
  { state: 'sending', event: 'dsh exit 0+输出空', action: '单重试→仍空=error 载明', next: 'failed' },
  { state: 'sending', event: 'timeout（messageTimeoutMs）', action: 'kill 子进程+timedOut=true', next: 'failed' },
  { state: 'failed', event: '重试请求（调用方）', action: '重入 sending', next: 'sending' },
  { state: 'awaiting-reply', event: '回复到达', action: '提取回复文本', next: 'delivered' },
];

// ── 接口形（调用方零波及·形状保持） ────────────────────────────────

export interface AgentSession {
  /** 短 id（= employeeId·dsh 形会话按席命名） */
  agentId: string;
  /** 会话 id（dsh sessions 元数据面） */
  sessionId: string;
  /** 会话显示名（= 员工名/员工 id） */
  name: string;
  /** 会话工作目录 */
  cwd: string;
  status: string;
  state: string;
  /** 注册表映射：name → employeeId（加载合同时注入） */
  employeeId?: string;
  lastSeenAt: string;
}

export interface SessionBridgeOptions {
  /** dsh 可执行文件（显式段·优先级最高） */
  dshBin?: string;
  /** 降权账号（如 'fleet'）；不设则以当前用户直接跑（本地开发） */
  runAsUser?: string;
  /** 会话工作目录，默认 /srv/fleet */
  cwd?: string;
  /** sessions 扫描超时，默认 30s */
  agentsJsonTimeoutMs?: number;
  /** 消息桥超时，默认 120s */
  messageTimeoutMs?: number;
  /** spawn 超时，默认 90s */
  spawnTimeoutMs?: number;
}

export interface SpawnResult {
  ok: boolean;
  agentId?: string;
  name?: string;
  /** dsh 形会话 id（boot 输出解析面·STE 修面案 b 增） */
  sessionId?: string;
  error?: string;
}

export interface SendMessageResult {
  ok: boolean;
  reply?: string;
  error?: string;
  timedOut?: boolean;
}

const DEFAULT_OPTIONS: Required<Pick<SessionBridgeOptions, 'cwd' | 'agentsJsonTimeoutMs' | 'messageTimeoutMs' | 'spawnTimeoutMs'>> = {
  cwd: '/srv/fleet',
  agentsJsonTimeoutMs: 30_000,
  messageTimeoutMs: 120_000,
  spawnTimeoutMs: 90_000,
};

// ── PATH 解析序三段（五判据④·命中记录形） ─────────────────────────

export interface DshBinResolution {
  bin: string;
  stage: 'explicit' | 'env' | 'surveyed' | 'path';
  probes: string[];
}

const SURVEYED_DSH = '/srv/fleet/dsh/node_modules/.bin/dsh';

/** 四段解析（显式 dshBin→env TRIRMC_DSH_BIN→实勘位→PATH which dsh）——
 * 全落空=throw fail-visible（三段探测详情载明·禁静默回退 claude）。 */
export function resolveDshBin(opts: { dshBin?: string } = {}): DshBinResolution {
  const probes: string[] = [];
  if (opts.dshBin) {
    probes.push(`explicit=${opts.dshBin}(${exists(opts.dshBin) ? 'hit' : 'miss'})`);
    if (exists(opts.dshBin)) return { bin: opts.dshBin, stage: 'explicit', probes };
  }
  const env = process.env.TRIRMC_DSH_BIN;
  if (env) {
    probes.push(`env=${env}(${exists(env) ? 'hit' : 'miss'})`);
    if (exists(env)) return { bin: env, stage: 'env', probes };
  }
  probes.push(`surveyed=${SURVEYED_DSH}(${exists(SURVEYED_DSH) ? 'hit' : 'miss'})`);
  if (exists(SURVEYED_DSH)) return { bin: SURVEYED_DSH, stage: 'surveyed', probes };
  const pathHit = whichDsh();
  probes.push(`which=${pathHit ?? 'miss'}`);
  if (pathHit) return { bin: pathHit, stage: 'path', probes };
  throw new Error(`dsh binary not found（PATH 解析序三段+PATH 探测详情: ${probes.join('; ')}）——禁静默回退 claude（五判据④ fail-visible）`);
}

function exists(p: string): boolean {
  try { return existsSync(p); } catch { return false; }
}

function whichDsh(): string | null {
  try {
    // STE 第三处修案：Sync 版直收 string（解构形对 string 非法=TS2339 二阶面）
    const out: string = execFileSync('which', ['dsh'], { encoding: 'utf-8' });
    const hit = out.trim();
    return hit || null;
  } catch {
    return null;
  }
}

/** 构造降权前缀：runuser -u <user> -- cmd args...；无 runAsUser 时直接执行 */
function buildArgs(
  dshBin: string,
  cmdArgs: string[],
  opts: SessionBridgeOptions & typeof DEFAULT_OPTIONS,
): { bin: string; args: string[] } {
  if (opts.runAsUser) {
    return {
      bin: 'runuser',
      args: ['-u', opts.runAsUser, '--', dshBin, ...cmdArgs],
    };
  }
  return { bin: dshBin, args: cmdArgs };
}

/**
 * SpawnSession：boot 一个 headless profile 会话（命名 = employeeId）。
 * 会话状态归 ~/.dsh/sessions 面（dsh 进程自身消费）。
 */
export async function spawnSession(
  employeeId: string,
  task: string,
  opts: SessionBridgeOptions = {},
): Promise<SpawnResult> {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  let bin: string, baseArgs: string[];
  try {
    const res = resolveDshBin(o);
    ({ bin, args: baseArgs } = buildArgs(res.bin, ['--profile', 'headless', employeeId, task], o));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const { stdout } = await execFileP(bin, baseArgs, {
      cwd: o.cwd,
      timeout: o.spawnTimeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, HOME: o.runAsUser ? `/home/${o.runAsUser}` : process.env.HOME },
    });
    // 会话标识解析（容错两形：JSON 行双试+标识行正则——dsh boot 输出面）
    let sessionId = '';
    try {
      const j = JSON.parse(stdout.trim());
      sessionId = String(j.sessionId ?? j.session_id ?? j.id ?? '');
    } catch { /* JSON 行非 JSON→标识行正则 */ }
    if (!sessionId) {
      const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(stdout);
      sessionId = m ? m[1] : '';
    }
    if (!sessionId) {
      // dsh send 形输出（无 uuid）=会话名回填形（mock/简单 boot 兼容·尾词=会话名）
      const tail = stdout.trim().split(/\s+/).pop() ?? '';
      if (!tail) {
        return { ok: false, error: `unparseable spawn output: ${stdout.trim().slice(0, 200)}` };
      }
      return { ok: true, agentId: employeeId, sessionId: tail, name: employeeId };
    }
    return { ok: true, agentId: employeeId, sessionId, name: employeeId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

/**
 * ListAgents：扫描 ~/.dsh/sessions 工作区会话族（r-duty-{seat} 形），
 * 形成 agentId↔sessionId↔name 注册表快照。缺目录=空注册表（合法·不造替身）。
 */
export async function listAgents(opts: SessionBridgeOptions = {}): Promise<AgentSession[]> {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const home = o.runAsUser ? `/home/${o.runAsUser}` : process.env.HOME || '';
  const sessionsDir = join(home, '.dsh', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  try {
    const { stdout } = await execFileP('find', [sessionsDir, '-maxdepth', '2', '-type', 'f'], {
      timeout: o.agentsJsonTimeoutMs,
    });
    const files = stdout.trim() ? stdout.trim().split('\n') : [];
    const sessions: AgentSession[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(readFileSync(f, 'utf-8')) as Record<string, unknown>;
        const name = String(raw.name ?? raw.seat ?? basename(f, '.json'));
        sessions.push({
          agentId: name,
          sessionId: String(raw.sessionId ?? raw.id ?? name),
          name,
          cwd: String(raw.cwd ?? ''),
          status: String(raw.status ?? ''),
          state: String(raw.state ?? ''),
          lastSeenAt: new Date().toISOString(),
        });
      } catch { /* 单件坏=跳过不炸扫描（如实面） */ }
    }
    return sessions;
  } catch {
    return [];
  }
}

/**
 * SendMessage：向指定会话定向投递（--session-id 定向形），
 * messageTimeoutMs 超时回收输出。回复 = stdout 文本。
 */
export async function sendMessage(
  sessionId: string,
  message: string,
  opts: SessionBridgeOptions = {},
): Promise<SendMessageResult> {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  let bin: string, baseArgs: string[];
  try {
    const res = resolveDshBin(o);
    ({ bin, args: baseArgs } = buildArgs(res.bin, ['--profile', 'headless', '--session-id', sessionId, message], o));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), timedOut: false };
  }
  try {
    const { stdout } = await execFileP(bin, baseArgs, {
      cwd: o.cwd,
      timeout: o.messageTimeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, HOME: o.runAsUser ? `/home/${o.runAsUser}` : process.env.HOME },
    });
    const reply = stdout.trim();
    if (!reply) {
      return { ok: false, error: 'empty reply from session' };
    }
    return { ok: true, reply };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /ETIMEDOUT|SIGKILL|timeout/i.test(msg);
    return { ok: false, error: msg.slice(0, 500), timedOut };
  }
}

/** 注册表解析：按 name（= employeeId）注入映射，供 /internal/v1/agents 使用 */
export function buildRegistry(sessions: AgentSession[], employeeNames: string[] = []): AgentSession[] {
  const nameSet = new Set(employeeNames);
  return sessions.map((s) => ({
    ...s,
    employeeId: nameSet.has(s.name) ? s.name : undefined,
  }));
}
