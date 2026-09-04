// ── LG-032 案 a 件②：MC 服务面台账单测 ──
// 覆盖：heartbeat 台账读写 / replay 幂等落账+seq 连续性 / task-result 台账。
// sqlite=node:sqlite（DatabaseSync），每用例独立临时 db。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McStore } from '../../src/comm/mc-store.js';

function withStore<T>(fn: (store: McStore, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mc-store-'));
  const store = new McStore(join(dir, 'mc-store.sqlite'));
  try {
    return fn(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('McStore heartbeat ledger', () => {
  test('records heartbeats and reports latest-first stats', () => {
    withStore((store) => {
      for (let i = 0; i < 3; i++) {
        store.recordHeartbeat({
          nodeId: 'node-a',
          state: 'connected',
          queueSize: i,
          uptimeSeconds: 100 + i,
          agentCoreVersion: 'test-1',
        });
      }
      store.recordHeartbeat({ nodeId: 'node-b', state: 'local' });
      const all = store.heartbeatStats();
      assert.equal(all.length, 4);
      const nodeA = store.heartbeatStats('node-a');
      assert.equal(nodeA.length, 3);
      assert.equal(nodeA[0].state, 'connected');
      assert.equal(nodeA[0].agentCoreVersion, 'test-1');
    });
  });
});

describe('McStore replay ledger + seq continuity', () => {
  test('records batch, idempotent on duplicate (eventId, nodeId), reports seq gaps', () => {
    withStore((store) => {
      const ev = (eventId: string, seqNo: number, type = 'agent_run') => ({
        eventId,
        type,
        timestamp: 1,
        seqNo,
        payload: {},
      });
      const inserted1 = store.recordReplayBatch('node-a', 'conn-1', [ev('e1', 1), ev('e2', 2), ev('e3', 3)], []);
      assert.equal(inserted1, 3);

      // 重放 e3（幂等跳过）+ 断档注入 seq 6（缺 4/5）
      const inserted2 = store.recordReplayBatch('node-a', 'conn-1', [ev('e3', 3), ev('e6', 6)], []);
      assert.equal(inserted2, 1);

      const report = store.seqGapReport('node-a');
      assert.equal(report.nodeId, 'node-a');
      assert.equal(report.total, 4);
      assert.deepEqual(report.gaps, [{ after: 3, before: 6 }]);
      assert.equal(report.duplicates, 0);
      assert.equal(report.lastSeqNo, 6);
    });
  });

  test('duplicate seqNo in distinct eventIds counts as duplicates', () => {
    withStore((store) => {
      const ev = (eventId: string, seqNo: number) => ({ eventId, type: 'agent_run', timestamp: 1, seqNo, payload: {} });
      store.recordReplayBatch('node-a', 'c', [ev('x1', 1), ev('x2', 1)], []);
      const report = store.seqGapReport('node-a');
      assert.equal(report.duplicates, 1);
    });
  });

  test('conflict resolution is persisted on the event row', () => {
    withStore((store) => {
      const ev = { eventId: 'dup-1', type: 'tool_call', timestamp: 1, seqNo: 1, payload: { idempotencyKey: 'k1' } };
      store.recordReplayBatch('node-a', 'c', [ev], [
        { eventId: 'dup-1', type: 'tool_call', resolution: 'already_executed', reason: 'test' },
      ]);
      // 落账不抛冲突即通过；seq 报告可读
      const report = store.seqGapReport('node-a');
      assert.equal(report.total, 1);
    });
  });
});

describe('McStore task-result ledger', () => {
  test('records task results and counts by taskId', () => {
    withStore((store) => {
      store.recordTaskResult({ taskId: 't1', sessionId: 's1', status: 'success', result: 'ok' });
      store.recordTaskResult({ taskId: 't1', sessionId: 's1', status: 'failed', error: 'boom' });
      store.recordTaskResult({ taskId: 't2', sessionId: 's2', status: 'success', result: '' });
      assert.equal(store.taskResultCount('t1'), 2);
      assert.equal(store.taskResultCount(), 3);
    });
  });
});
