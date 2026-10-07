/**
 * cron-write-gate tests — S2 fail-closed（2026-10-07，判据 cto-s2-trirmc-token-gate-spec §三.3）：
 * 四态矩阵真实 createTriMCApp 装配——未配+写=403／未配+读=200／配+错头=401／配+对头=201；
 * 两拒态分沟断言（403 internal_token_required ≠ 401 unauthorized 形状）；
 * 启动 WARN 日志断言（internal token not configured: cron write endpoints reject）。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { overrideConfigDir, resetConfigDir, invalidateJobStoreCache } from '@tricompany/agent-core';
import { createTriMCApp } from '../../src/server/app.js';
import { readEnv, type TriMCEnv } from '../../src/config/env.js';

const TOKEN = 'test-token-0123456789abcdef';

describe('TriMC cron write-family fail-closed gate (S2)', () => {
  let app: { start(): Promise<void>; stop(): Promise<void>; port: number };
  let tmpConfigDir: string;
  let baseUrl: string;
  const prevConfigDir = process.env.TRIRMC_CONFIG_DIR;
  const prevToken = process.env.TRIRMC_INTERNAL_TOKEN;
  const jobBody = JSON.stringify({
    name: 's2-probe',
    schedule: { kind: 'at', atMs: 4_000_000_000_000 },
    payload: { command: 'echo s2', cwd: '/tmp' },
  });

  before(async () => {
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimc-s2-gate-'));
    process.env.TRIRMC_CONFIG_DIR = tmpConfigDir;
    overrideConfigDir(tmpConfigDir);
    invalidateJobStoreCache();
    delete process.env.TRIRMC_INTERNAL_TOKEN;

    // 启动 WARN 断言：token 未配置 boot → console.warn 捕获（S2 §二.1）
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };
    try {
      const env: TriMCEnv = { ...readEnv(), port: 0, cronEnabled: true };
      app = createTriMCApp(env);
      await app.start();
    } finally {
      console.warn = origWarn;
    }
    assert.ok(
      warns.some((w) => w.includes('internal token not configured: cron write endpoints reject')),
      'boot with token unset must WARN about cron write endpoints rejecting',
    );
    baseUrl = `http://127.0.0.1:${app.port}`;
  });

  after(async () => {
    await app.stop();
    resetConfigDir();
    invalidateJobStoreCache();
    if (prevConfigDir === undefined) delete process.env.TRIRMC_CONFIG_DIR;
    else process.env.TRIRMC_CONFIG_DIR = prevConfigDir;
    if (prevToken === undefined) delete process.env.TRIRMC_INTERNAL_TOKEN;
    else process.env.TRIRMC_INTERNAL_TOKEN = prevToken;
  });

  it('未配 token：POST jobs → 403 internal_token_required', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/cron/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jobBody,
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'internal_token_required');
  });

  it('未配 token：POST jobs/{id}/run → 403', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/cron/jobs/whatever/run`, { method: 'POST' });
    assert.equal(res.status, 403);
  });

  it('未配 token：PATCH jobs/{id} → 403', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/cron/jobs/whatever`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 403);
  });

  it('未配 token：DELETE jobs/{id} → 403', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/cron/jobs/whatever`, { method: 'DELETE' });
    assert.equal(res.status, 403);
  });

  it('未配 token：读族过渡——GET jobs/log/status → 200', async () => {
    const jobs = await fetch(`${baseUrl}/internal/v1/cron/jobs`);
    assert.equal(jobs.status, 200);
    const log = await fetch(`${baseUrl}/internal/v1/cron/log`);
    assert.equal(log.status, 200);
    const status = await fetch(`${baseUrl}/internal/v1/cron/status`);
    assert.equal(status.status, 200);
  });

  it('配 token+错头：POST jobs → 401（全域门；拒态与 403 分沟）', async () => {
    process.env.TRIRMC_INTERNAL_TOKEN = TOKEN;
    const res = await fetch(`${baseUrl}/internal/v1/cron/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'wrong-token' },
      body: jobBody,
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.ok(
      (body.error ?? '').includes('unauthorized'),
      '401 body shape must differ from the 403 internal_token_required shape',
    );
  });

  it('配 token+对头：POST jobs → 201；带头读族 → 200；清理 DELETE → 200', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/cron/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
      body: jobBody,
    });
    assert.equal(res.status, 201);
    const job = ((await res.json()) as { job: { id: string } }).job;

    const list = await fetch(`${baseUrl}/internal/v1/cron/jobs`, {
      headers: { 'x-internal-token': TOKEN },
    });
    assert.equal(list.status, 200);

    const cleanup = await fetch(`${baseUrl}/internal/v1/cron/jobs/${job.id}`, {
      method: 'DELETE',
      headers: { 'x-internal-token': TOKEN },
    });
    assert.equal(cleanup.status, 200);
  });
});
