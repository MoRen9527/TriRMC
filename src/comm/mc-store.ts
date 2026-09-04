// ── MC Service-Face Ledger (SQLite) ──
// LG-032 案 a 件②：TriRMC MC 服务面台账/仲裁存储。
// - mc_heartbeats：心跳接收台账（验证门读数：连续 N 周期 0 超时）
// - mc_events：replay 仲裁存储（eventId 幂等 + seq 连续性）
// - mc_task_results：tasks/result 回传台账
//
// 存储=node:sqlite（DatabaseSync，node >=22.5；河源 v22.23.2 / 本机 v22.21.1 已核）。
// WAL 模式：同仓多进程（trirmc.service 8712 / trirmc-mc.service 8710）共存安全；
// 各服务实例用独立 db 文件（TRIRMC_MC_DB_PATH）零共享。

import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ReplayEvent, ConflictItem } from './arbitration.js';

export interface HeartbeatRecord {
  nodeId: string;
  state: string;
  queueSize: number;
  uptimeSeconds: number;
  agentCoreVersion: string;
  receivedAt: number;
}

export interface SeqGapReport {
  nodeId: string;
  total: number;
  gaps: Array<{ after: number; before: number }>; // seqNo 断档：…after → [缺] → before…
  duplicates: number;
  lastSeqNo: number;
}

export class McStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mc_heartbeats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        state TEXT NOT NULL,
        queue_size INTEGER NOT NULL DEFAULT 0,
        uptime_seconds INTEGER NOT NULL DEFAULT 0,
        agent_core_version TEXT NOT NULL DEFAULT '',
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hb_node_time ON mc_heartbeats(node_id, received_at);

      CREATE TABLE IF NOT EXISTS mc_events (
        event_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        connection_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        seq_no INTEGER NOT NULL,
        timestamp INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL DEFAULT '{}',
        resolution TEXT NOT NULL DEFAULT 'accepted',  -- accepted | conflict:<resolution>
        received_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ev_node_seq ON mc_events(node_id, seq_no);

      CREATE TABLE IF NOT EXISTS mc_task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tr_task ON mc_task_results(task_id, received_at);
    `);
  }

  recordHeartbeat(hb: {
    nodeId: string;
    state?: string;
    queueSize?: number;
    uptimeSeconds?: number;
    agentCoreVersion?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO mc_heartbeats (node_id, state, queue_size, uptime_seconds, agent_core_version, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hb.nodeId,
        hb.state ?? 'unknown-state',
        hb.queueSize ?? 0,
        hb.uptimeSeconds ?? 0,
        hb.agentCoreVersion ?? '',
        Date.now(),
      );
  }

  /** 心跳台账读数（验证门：最近 N 条连续接收统计）。 */
  heartbeatStats(nodeId?: string, limit = 50): Array<HeartbeatRecord & { id: number }> {
    const rows = nodeId
      ? this.db
          .prepare(
            `SELECT id, node_id, state, queue_size, uptime_seconds, agent_core_version, received_at
             FROM mc_heartbeats WHERE node_id = ? ORDER BY received_at DESC LIMIT ?`,
          )
          .all(nodeId, limit)
      : this.db
          .prepare(
            `SELECT id, node_id, state, queue_size, uptime_seconds, agent_core_version, received_at
             FROM mc_heartbeats ORDER BY received_at DESC LIMIT ?`,
          )
          .all(limit);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id),
      nodeId: String(r.node_id),
      state: String(r.state),
      queueSize: Number(r.queue_size),
      uptimeSeconds: Number(r.uptime_seconds),
      agentCoreVersion: String(r.agent_core_version),
      receivedAt: Number(r.received_at),
    }));
  }

  /**
   * replay 批次落账（幂等：同 (eventId, nodeId) 重放跳过计数，不改首录）。
   * 返回新落账行数（与 accepted 对账用）。
   */
  recordReplayBatch(
    nodeId: string,
    connectionId: string,
    events: ReplayEvent[],
    conflicts: ConflictItem[],
  ): number {
    const conflictByEvent = new Map(conflicts.map((c) => [c.eventId, c.resolution]));
    let inserted = 0;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO mc_events (event_id, node_id, connection_id, type, seq_no, timestamp, payload, resolution, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const ev of events) {
      const resolution = conflictByEvent.get(ev.eventId) ?? 'accepted';
      const res = stmt.run(
        ev.eventId,
        nodeId,
        connectionId,
        ev.type,
        ev.seqNo,
        ev.timestamp ?? 0,
        JSON.stringify(ev.payload ?? {}),
        resolution,
        Date.now(),
      );
      inserted += Number(res.changes);
    }
    return inserted;
  }

  /** seq 连续性报告（验证门：seq 连续无洞）。 */
  seqGapReport(nodeId: string): SeqGapReport {
    const rows = this.db
      .prepare(`SELECT seq_no, COUNT(*) AS n FROM mc_events WHERE node_id = ? GROUP BY seq_no ORDER BY seq_no`)
      .all(nodeId) as Array<{ seq_no: number; n: number }>;
    const gaps: SeqGapReport['gaps'] = [];
    let duplicates = 0;
    let prev = 0;
    let first = true;
    for (const r of rows) {
      if (Number(r.n) > 1) duplicates += Number(r.n) - 1;
      const seq = Number(r.seq_no);
      if (!first && seq > prev + 1) gaps.push({ after: prev, before: seq });
      prev = seq;
      first = false;
    }
    return { nodeId, total: rows.length, gaps, duplicates, lastSeqNo: prev };
  }

  recordTaskResult(body: {
    taskId?: string;
    sessionId?: string;
    status?: string;
    result?: string;
    error?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO mc_task_results (task_id, session_id, status, result, error, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.taskId ?? '',
        body.sessionId ?? '',
        body.status ?? 'unknown',
        body.result ?? '',
        body.error ?? '',
        Date.now(),
      );
  }

  taskResultCount(taskId?: string): number {
    const rows = taskId
      ? this.db.prepare(`SELECT COUNT(*) AS n FROM mc_task_results WHERE task_id = ?`).all(taskId)
      : this.db.prepare(`SELECT COUNT(*) AS n FROM mc_task_results`).all();
    return Number((rows[0] as { n: number }).n);
  }

  close(): void {
    this.db.close();
  }
}
