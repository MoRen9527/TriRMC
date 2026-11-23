// ── DP-20261123-032（CTO 技术形 db0635eb）：D-91 链跑期禁推——链跑态 marker ──
// 链面小改：ignite 启动写 `.running`{pid,runId,start_at}·进程退出删除；
// 闸端（pre-receive bare 面·SDE）=存在即拒 dev 业务码推送；**stale>2h 保护**：
// mtime 超 2h 视为崩溃残迹→闸端放行+告警（isChainRunning 返回 stale 标记）。
// 位置：env TRI_CHAIN_MARKER 覆写；**缺省=R-HY 本机 `/srv/fleet/TriRMC/chain-running.marker`**
// （CTO 修 A 2026-11-23·机位勘正：TriCompany bare 真位=**sg**（/srv/git/TriCompany.git）·
//  R-HY 无 /srv/git——旧缺省「R-HY 本机 bare」系机位错位假设，已勘）。
// ⚠ 跨机可见性缺口（如实）：sg 侧 pre-receive 读的是 **sg 本机**同名路径·R-HY 写的文件
// 跨机不可见（两机独立·sg /srv/fleet/TriRMC=独立 duty 副本）——闸端真正跨机信号候
// ref 形（chain 推/删 `refs/runtime/chain-running` 于 sg bare·hook for-each-ref）CTO 裁。
import { existsSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const CHAIN_MARKER_DEFAULT = '/srv/fleet/TriRMC/chain-running.marker';   // CTO 修 A（R-HY 实位·机位勘正）
export const CHAIN_MARKER_STALE_MS = 2 * 60 * 60 * 1000;   // >2h = stale 保护窗

export function markerPath(): string {
  return process.env.TRI_CHAIN_MARKER || CHAIN_MARKER_DEFAULT;
}


// ── R 形（CTO 裁 2026-11-23·跨机正形）：marker 以 bare ref 承载——两机唯一共享面。
// 链启动 push `<marker-sha>:refs/runtime/chain-running`（空提交消息带 {pid,runId,start_at}）；
// 链毕 push 删该 ref；sg hook 用 for-each-ref + `git log -1 --format=%cd` 判 stale>2h。
// 边界（CTO ③）：push 失败=无 ref→闸端放行（fail-open）+告警；refs/runtime/ 非 heads/tags 不扰 fetch。
export const CHAIN_MARKER_REF = 'refs/runtime/chain-running';

export function writeChainMarkerRef(tcRoot: string, runId: string, remote = 'origin'): boolean {
  try {
    const payload = JSON.stringify({ pid: process.pid, runId, start_at: new Date().toISOString() });
    const tree = execFileSync('git', ['mktree'], { cwd: tcRoot, input: '', encoding: 'utf8' }).trim();
    const sha = execFileSync('git', ['commit-tree', tree, '-m', payload], { cwd: tcRoot, encoding: 'utf8' }).trim();
    execFileSync('git', ['push', '--quiet', remote, `+${sha}:${CHAIN_MARKER_REF}`], { cwd: tcRoot, encoding: 'utf8' });
    return true;
  } catch (e) {
    console.error(`[chain-marker-ref] push failed (fail-open·闸端放行+告警面): ${e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : String(e)}`);
    return false;
  }
}

export function clearChainMarkerRef(tcRoot: string, remote = 'origin'): boolean {
  try {
    execFileSync('git', ['push', '--quiet', remote, `:${CHAIN_MARKER_REF}`], { cwd: tcRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;   // 无 ref/通道断=幂等忽略
  }
}

/** 闸端/白盒查询（bare 仓 cwd）：ref absent/running/stale + marker 消息。 */
export function chainRefInfo(bareRepo: string, nowMs?: number): { state: 'absent' | 'running' | 'stale'; raw?: string } {
  try {
    const out = execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname) %(committerdate:unix)', CHAIN_MARKER_REF],
      { cwd: bareRepo, encoding: 'utf8' }).trim();
    if (!out) return { state: 'absent' };
    const parts = out.split(/\s+/);
    const ts = Number(parts[2]) * 1000;
    const raw = execFileSync('git', ['log', '-1', '--format=%B', parts[1]], { cwd: bareRepo, encoding: 'utf8' }).trim();
    const age = (nowMs ?? Date.now()) - ts;
    return { state: age > CHAIN_MARKER_STALE_MS ? 'stale' : 'running', raw };
  } catch {
    return { state: 'absent' };
  }
}

export interface ChainMarker { pid: number; runId: string; start_at: string; }

/** 链启动写 marker（失败=warn 不阻断链跑；门哨面 fail-open 于写侧·拒面由闸端 stale 保护兜）。 */
export function writeChainMarker(runId: string): boolean {
  const p = markerPath();
  try {
    const doc: ChainMarker = { pid: process.pid, runId, start_at: new Date().toISOString() };
    writeFileSync(p, JSON.stringify(doc, null, 2) + String.fromCharCode(10), 'utf8');
    return true;
  } catch (e) {
    console.error(`[chain-marker] write failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** 链毕/退出删 marker（仅 pid 归属本进程时删·防误删他链）。 */
export function clearChainMarker(): boolean {
  const p = markerPath();
  try {
    if (!existsSync(p)) return true;
    const doc = JSON.parse(readFileSync(p, 'utf8')) as ChainMarker;
    if (doc?.pid !== process.pid) return false;   // 非本进程 marker 不删
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 闸端查询（SDE pre-receive 同构用）：running/stale/absent 三态。 */
export function isChainRunning(nowMs?: number): { state: 'absent' | 'running' | 'stale'; marker?: ChainMarker } {
  const p = markerPath();
  if (!existsSync(p)) return { state: 'absent' };
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as ChainMarker;
    const age = (nowMs ?? Date.now()) - statSync(p).mtimeMs;
    if (age > CHAIN_MARKER_STALE_MS) return { state: 'stale', marker: doc };
    return { state: 'running', marker: doc };
  } catch {
    return { state: 'stale' };   // 坏卷=保守按 stale（放行+告警面）
  }
}
