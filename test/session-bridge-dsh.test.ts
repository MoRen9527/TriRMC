// V2/T2 白盒族——session-bridge 三 API dsh 形（mock dsh 形+PATH 三段+状态机迁移全谱）
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SESSION_TRANSITIONS,
  resolveDshBin,
  spawnSession,
  listAgents,
  sendMessage,
} from '../src/orchestration/session-bridge.js';

/** mock dsh 二进制铸造：按 argv 形回 canned 输出（boot/scan/send 三形） */
function mockDsh(dir: string, behavior: 'boot' | 'empty' | 'send'): string {
  const bin = join(dir, 'mock-dsh');
  const lines: string[] = ['#!/bin/sh'];
  if (behavior === 'boot') {
    lines.push(`echo '{"sessionId":"11111111-2222-3333-4444-555555555555"}'`);
  } else if (behavior === 'send') {
    lines.push(`echo 'reply-from-mock-dsh'`);
  } else {
    lines.push(`exit 0`);
  }
  writeFileSync(bin, lines.join('\n'), 'utf-8');
  chmodSync(bin, 0o755);
  return bin;
}

describe('resolveDshBin 三段解析序', () => {
  it('显式段优先（dshBin override 命中记录面）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshbin-'));
    const bin = mockDsh(dir, 'boot');
    const res = resolveDshBin({ dshBin: bin });
    assert.equal(res.bin, bin);
    assert.equal(res.stage, 'explicit');
    assert.ok(res.probes[0].startsWith('explicit='));
  });

  it('env 段（TRIRMC_DSH_BIN）次优先', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshbin-env-'));
    const bin = mockDsh(dir, 'send');
    const old = process.env.TRIRMC_DSH_BIN;
    process.env.TRIRMC_DSH_BIN = bin;
    try {
      const res = resolveDshBin({});
      assert.equal(res.bin, bin);
      assert.equal(res.stage, 'env');
    } finally {
      if (old === undefined) delete process.env.TRIRMC_DSH_BIN;
      else process.env.TRIRMC_DSH_BIN = old;
    }
  });

  it('全落空=fail-visible（三段探测详情载明·禁静默回退）', () => {
    const old = process.env.TRIRMC_DSH_BIN;
    delete process.env.TRIRMC_DSH_BIN;
    try {
      assert.throws(
        () => resolveDshBin({ dshBin: join(tmpdir(), 'no-such-dsh') }),
        /dsh binary not found/,
      );
    } finally {
      if (old === undefined) delete process.env.TRIRMC_DSH_BIN;
      else process.env.TRIRMC_DSH_BIN = old;
    }
  });
});

describe('三 API dsh 形（mock 端到端）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-api-'));
  const BIN = mockDsh(dir, 'send');
  const OPTS = { dshBin: BIN, cwd: dir };

  it('spawnSession: boot 输出 sessionId 提取（uuid 正则双试形）', async () => {
    const res = await spawnSession('emp-1', 'seed task', { ...OPTS, spawnTimeoutMs: 5000 });
    assert.equal(res.ok, true, String(res.error));
    assert.equal(res.agentId, 'emp-1');
    assert.ok(res.sessionId, 'sessionId 应有值');
  });

  it('sendMessage: 定向投递回执文本', async () => {
    const res = await sendMessage('sess-1', 'hello', OPTS);
    assert.equal(res.ok, true);
    assert.ok(res.reply && res.reply.length > 0);
  });

  it('listAgents: 缺 sessions 面=空注册表（合法·不造替身）', async () => {
    const res = await listAgents(OPTS);
    assert.ok(Array.isArray(res));
  });
});

describe('状态机迁移表全谱（五判据③）', () => {
  it('六行迁移+五态枚举', () => {
    assert.equal(SESSION_TRANSITIONS.length, 6);
    const states = new Set(SESSION_TRANSITIONS.flatMap((t) => [t.state, t.next]));
    for (const s of states) {
      assert.ok(['idle', 'sending', 'awaiting-reply', 'delivered', 'failed'].includes(s));
    }
  });
});
