// ── DP-20261123-032（CTO 技术形 db0635eb）：D-91 链跑期禁推——链跑态 marker ──
// 链面小改：ignite 启动写 `.running`{pid,runId,start_at}·进程退出删除；
// 闸端（pre-receive bare 面·SDE）=存在即拒 dev 业务码推送；**stale>2h 保护**：
// mtime 超 2h 视为崩溃残迹→闸端放行+告警（isChainRunning 返回 stale 标记）。
// 位置：env TRI_CHAIN_MARKER 覆写；缺省 `/srv/git/TriCompany.git/chain-running.marker`
// （R-HY 本机 bare 与 runs 同文件系统·fleet 可写）。
import { existsSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs';

export const CHAIN_MARKER_DEFAULT = '/srv/git/TriCompany.git/chain-running.marker';
export const CHAIN_MARKER_STALE_MS = 2 * 60 * 60 * 1000;   // >2h = stale 保护窗

export function markerPath(): string {
  return process.env.TRI_CHAIN_MARKER || CHAIN_MARKER_DEFAULT;
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
