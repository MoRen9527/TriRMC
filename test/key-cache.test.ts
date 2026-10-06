import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyKeyCacheToEnvironment,
  FACE_ID,
  PULL_ATTRIBUTION_CODES,
  keysFromPullEntries,
  getKeyCacheFilePath,
  initKeyCache,
  getKeyCache,
  getKeyCacheStatus,
  stopKeyCache,
  onKeyCacheUpdated,
  refreshNow,
  describeConfig,
  verifyPull,
  clearKeyCache,
  type KeyCache,
  type PullEntry,
} from '../src/config/key-cache.js';
import { readEnv } from '../src/config/env.js';

describe('applyKeyCacheToEnvironment', () => {
  it('maps cached providers to the TriModel environment contract', () => {
    const cache: KeyCache = {
      keys: {
        deepseek: { api_key: 'deepseek-key', base_url: 'https://deepseek.example/v1' },
        anthropic: { api_key: 'anthropic-key', base_url: 'https://anthropic.example' },
        openai: { api_key: 'openai-key', base_url: 'https://openai.example/v1' },
        trimetaverse: { api_key: 'tmv-key', base_url: 'https://tmv.example/v1' },
      },
      defaultModel: 'deepseek-chat',
      refreshIntervalS: 900,
      fetchedAt: 1,
      expiresAt: 2,
    };
    const env: NodeJS.ProcessEnv = {};

    applyKeyCacheToEnvironment(cache, env);

    assert.deepEqual(env, {
      DEEPSEEK_API_KEY: 'deepseek-key',
      DEEPSEEK_BASE_URL: 'https://deepseek.example/v1',
      ANTHROPIC_API_KEY: 'anthropic-key',
      ANTHROPIC_BASE_URL: 'https://anthropic.example',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://openai.example/v1',
      TRIMODEL_TRIMETAVERSE_API_KEY: 'tmv-key',
      TRIMODEL_TRISTACISS_BASE_URL: 'https://tmv.example/v1',
      TRIMODEL_DEFAULT_MODEL: 'deepseek-chat',
    });
  });
});

// ── LG-058 N3 泛化（config-cache 多维）：新案 ──

function pullEntriesFixture(): Record<string, PullEntry> {
  return {
    e1: { provider: 'deepseek', model: 'deepseek-v4-pro', api_key: 'sk-pull-e1', enabled: true, updated_at: '2026-09-28T01:00:00Z' },
    e2: { provider: 'deepseek', model: 'deepseek-v4-pro', api_key: 'sk-pull-e2-newer', enabled: true, updated_at: '2026-09-28T02:00:00Z' },
    e3: { provider: 'anthropic', model: 'claude-fallback', api_key: 'sk-ant-e3', enabled: true, updated_at: '2026-09-28T01:30:00Z', base_url: 'https://anthropic.example' },
    e4: { provider: 'openai', model: 'gpt-x', api_key: 'sk-disabled-ignored', enabled: false, updated_at: '2026-09-28T03:00:00Z' },
  };
}

/** env 钉位/恢复助手（S3 明文沙箱模式，避开 key-encryptor 域指纹依赖）。 */
function pinSandboxEnv(): () => void {
  const saved: Record<string, string | undefined> = {
    TRIMODEL_KEY_STORAGE_MODE: process.env.TRIMODEL_KEY_STORAGE_MODE,
    TRIMODEL_ADMIN_TOKEN: process.env.TRIMODEL_ADMIN_TOKEN,
  };
  process.env.TRIMODEL_KEY_STORAGE_MODE = 's3';
  delete process.env.TRIMODEL_ADMIN_TOKEN;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function withMockFetch(impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return () => { globalThis.fetch = real; };
}

describe('LG-058 N3 config-cache 泛化', () => {
  it('keysFromPullEntries: per-provider 取 updated_at 最新，disabled 排除，base_url 透传', () => {
    const keys = keysFromPullEntries(pullEntriesFixture());
    assert.equal(keys.deepseek?.api_key, 'sk-pull-e2-newer'); // 最新者胜
    assert.equal(keys.anthropic?.api_key, 'sk-ant-e3');
    assert.equal(keys.anthropic?.base_url, 'https://anthropic.example');
    assert.equal(keys.openai, undefined); // disabled 不进 keys
  });

  it('FACE_ID 默认 rlc（TriRLC 仓域面身份）；归因码三枚举冻结', () => {
    assert.equal(FACE_ID, 'rmc');
    assert.deepEqual([...PULL_ATTRIBUTION_CODES], ['pull_denied', 'decrypt_failed', 'apply_rejected']);
  });

  it('getKeyCacheFilePath: tier2 载体=config-cache.json（泛化名）', () => {
    assert.ok(getKeyCacheFilePath('D:/tmp/x').endsWith('config-cache.json'));
  });

  it('initKeyCache 端到端（S3 沙箱）：pull 成功→cache 落盘含 strategy+keys 聚合', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n3-'));
    const restore = pinSandboxEnv();
    try {
      const restoreFetch = withMockFetch(async (input) => {
        const url = String(input);
        assert.ok(url.includes('/v1/config/cards/rmc?view=pull'), `tier1 端点应为卡面 pull: ${url}`);
        return new Response(JSON.stringify({
          object: 'config.card-pull', face: 'rmc', card_present: true,
          default_model: 'deepseek-v4-pro',
          entries: pullEntriesFixture(),
          strategy: { id: 's1', name: 'sandbox-strategy', rule_ids: ['r1'] },
          refresh_interval_s: 900,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const cache = getKeyCache();
        assert.ok(cache);
        assert.equal(cache.defaultModel, 'deepseek-v4-pro');
        assert.equal(cache.keys.deepseek?.api_key, 'sk-pull-e2-newer');
        assert.deepEqual(cache.strategy, { id: 's1', name: 'sandbox-strategy', rule_ids: ['r1'] });
        // tier2 载体落盘 = config-cache.json（新名），S3 明文形态可断言
        assert.ok(existsSync(join(dir, 'config-cache.json')));
        const onDisk = JSON.parse(readFileSync(join(dir, 'config-cache.json'), 'utf-8'));
        assert.equal(onDisk.strategy?.id, 's1');
        assert.equal(getKeyCacheStatus().hasCache, true);
      } finally {
        stopKeyCache();
        restoreFetch();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('401 → pull_denied 归因；status 回写带 admin 凭据时发出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n3-'));
    const restore = pinSandboxEnv();
    process.env.TRIMODEL_ADMIN_TOKEN = 'admin-sandbox';
    try {
      const statusCalls: Array<{ url: string; body: unknown }> = [];
      const restoreFetch = withMockFetch(async (input, init) => {
        const url = String(input);
        if (url.includes('/status')) {
          statusCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      });
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        assert.equal(getKeyCache(), null); // 无 cache 无成功拉取 → tier3
        const st = getKeyCacheStatus();
        assert.equal(st.lastAttribution, 'pull_denied');
        assert.equal(st.lastFetchError, 'TriModel card pull denied (401)');
        // pull_denied → 回写 failed+归因码（§3.3；admin 在场故发出）。
        // LG-058 N1：无 cache 被拒 → 当前生效层级=tier3（出厂默认）随回写同报。
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(statusCalls.length, 1);
        assert.deepEqual(statusCalls[0].body, { state: 'failed', error: 'pull_denied', tier: 3 });
        assert.ok(statusCalls[0].url.includes('/v1/config/cards/rmc/status'));
      } finally {
        stopKeyCache();
        restoreFetch();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LG-058 N1：pull ok → status 回写 applied+tier=1（当前层级=卡面拉取）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n1-'));
    const restore = pinSandboxEnv();
    process.env.TRIMODEL_ADMIN_TOKEN = 'admin-sandbox';
    try {
      const statusBodies: unknown[] = [];
      const restoreFetch = withMockFetch(async (input, init) => {
        const url = String(input);
        if (url.includes('/status')) {
          statusBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({
          object: 'config.card-pull', face: 'rmc', card_present: true,
          default_model: 'deepseek-v4-pro',
          entries: pullEntriesFixture(),
          strategy: { id: 's1', name: 'sandbox-strategy', rule_ids: ['r1'] },
          refresh_interval_s: 900,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(statusBodies.length, 1, 'pull ok → applied 回写恰一条');
        assert.deepEqual(statusBodies[0], { state: 'applied', tier: 1 });
      } finally {
        stopKeyCache();
        restoreFetch();
        delete process.env.TRIMODEL_ADMIN_TOKEN;
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('card_present:false = tier1 无源：保留既有 cache 不动；admin 缺席=回写跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n3-'));
    const restore = pinSandboxEnv();
    try {
      // 预置 tier2 cache
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config-cache.json'), JSON.stringify({
        keys: { deepseek: { api_key: 'sk-existing' } },
        defaultModel: 'deepseek-v4-pro',
        refreshIntervalS: 900,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      }));
      const statusCalls: string[] = [];
      const restoreFetch = withMockFetch(async (input) => {
        const url = String(input);
        if (url.includes('/status')) { statusCalls.push(url); return new Response('{}', { status: 200 }); }
        return new Response(JSON.stringify({ object: 'config.card-pull', face: 'rmc', card_present: false }), { status: 200 });
      });
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const cache = getKeyCache();
        assert.ok(cache, '既有 tier2 cache 保留');
        assert.equal(cache.keys.deepseek?.api_key, 'sk-existing');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(statusCalls.length, 0, 'admin 缺席=回写跳过');
      } finally {
        stopKeyCache();
        restoreFetch();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('模型维中继（L32 评估序投影）：card_present:false 载荷带 default_model → keys 保留仅刷模型', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n3-'));
    const restore = pinSandboxEnv();
    try {
      // 预置 tier2 cache（含凭据）
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config-cache.json'), JSON.stringify({
        keys: { deepseek: { api_key: 'sk-existing' } },
        defaultModel: 'deepseek-v4-pro',
        refreshIntervalS: 900,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      }));
      const updated: Array<{ defaultModel?: string }> = [];
      const restoreFetch = withMockFetch(async (input, init) => {
        const url = String(input);
        if (url.includes('/status')) return new Response('{}', { status: 200 });
        void init;
        return new Response(JSON.stringify({
          object: 'config.card-pull', face: 'rmc', card_present: false,
          default_model: 'GLM-5.3', default_model_source: 'policy',
        }), { status: 200 });
      });
      try {
        stopKeyCache();
        const { onKeyCacheUpdated } = await import('../src/config/key-cache.js');
        onKeyCacheUpdated((cache) => { updated.push({ defaultModel: cache.defaultModel }); });
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const cache = getKeyCache();
        assert.ok(cache);
        assert.equal(cache.defaultModel, 'GLM-5.3', 'default_model 中继生效（anchor③ 语义）');
        assert.equal(cache.keys.deepseek?.api_key, 'sk-existing', '凭据维保留 tier2 现值');
        const onDisk = JSON.parse(readFileSync(join(dir, 'config-cache.json'), 'utf-8'));
        assert.equal(onDisk.defaultModel, 'GLM-5.3');
        assert.equal(onDisk.keys.deepseek?.api_key, 'sk-existing');
      } finally {
        stopKeyCache();
        restoreFetch();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('legacy keys.json fallback：config-cache.json 未落时读旧载体', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n3-'));
    const restore = pinSandboxEnv();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'keys.json'), JSON.stringify({
        keys: { anthropic: { api_key: 'sk-legacy' } },
        defaultModel: 'claude-legacy',
        refreshIntervalS: 900,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      }));
      const restoreFetch = withMockFetch(async () => {
        throw new Error('network down');
      });
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const cache = getKeyCache();
        assert.ok(cache, 'legacy keys.json 经 fallback 仍为 tier2');
        assert.equal(cache.keys.anthropic?.api_key, 'sk-legacy');
        // 拉取失败后新文件不落（等首次成功 pull）——新载体写入仅在成功时
        assert.ok(!existsSync(join(dir, 'config-cache.json')));
      } finally {
        stopKeyCache();
        restoreFetch();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── LG-058 N4 CLI config 命令族（方案 §5.1）：daemon 内执行面四函数 ──

describe('LG-058 N4 config 命令族（refreshNow/describeConfig/verifyPull/clearKeyCache）', () => {
  it('refreshNow：手动拉取即时生效——cache 刷新+updated 回调照发+tier1 归因', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n4-'));
    const restore = pinSandboxEnv();
    let model = 'deepseek-v4-pro';
    const restoreFetch = withMockFetch(async (input) => {
      assert.ok(String(input).includes('/v1/config/cards/rmc?view=pull'));
      return new Response(JSON.stringify({
        object: 'config.card-pull', face: 'rmc', card_present: true,
        default_model: model, entries: pullEntriesFixture(),
        strategy: null, refresh_interval_s: 900,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
      let updates = 0;
      onKeyCacheUpdated(() => { updates += 1; });
      try {
        // 服务端翻转模型后手动 pull——daemon 侧即时生效（方案 §5.1 语义）
        model = 'GLM-5.3';
        const r = await refreshNow();
        assert.equal(r.ok, true);
        assert.equal(r.mode, 'full');
        assert.equal(r.source, 'tier1-card');
        assert.equal(r.defaultModel, 'GLM-5.3');
        assert.equal(getKeyCache()?.defaultModel, 'GLM-5.3');
        assert.equal(updates, 1, 'updated 回调照发（anchor③ 语义）');
        // failed 分支：500 → last-known-good 仍在=梯归因 tier2
        const restoreFail = withMockFetch(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
        try {
          const f = await refreshNow();
          assert.equal(f.ok, false);
          assert.equal(f.mode, 'failed');
          assert.equal(f.source, 'tier2-cache');
          assert.equal(f.defaultModel, 'GLM-5.3');
          assert.match(f.message, /500/);
        } finally {
          restoreFail();
        }
      } finally {
        stopKeyCache();
      }
    } finally {
      restoreFetch();
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('describeConfig 梯归因三态：tier3-env / tier2-cache-fresh / tier2-cache-stale-grace（7 天硬限=tier3）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n4-'));
    const restore = pinSandboxEnv();
    try {
      const bootFail = (): (() => void) => withMockFetch(async () => new Response('{}', { status: 500 }));
      // 无 cache → tier3
      let rf = bootFail();
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        assert.equal(describeConfig().hasCache, false);
        assert.equal(describeConfig().effectiveSource, 'tier3-env');
      } finally { stopKeyCache(); rf(); }

      // 新鲜 cache → tier2 fresh
      writeFileSync(join(dir, 'config-cache.json'), JSON.stringify({
        keys: { deepseek: { api_key: 'sk-x' } }, defaultModel: 'GLM-5.3', strategy: null,
        refreshIntervalS: 900, fetchedAt: Date.now(), expiresAt: Date.now() + 3600_000,
      }));
      rf = bootFail();
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const d = describeConfig();
        assert.equal(d.fresh, true);
        assert.equal(d.effectiveSource, 'tier2-cache-fresh');
        assert.equal(d.defaultModel, 'GLM-5.3');
        assert.deepEqual(d.providers, ['deepseek']);
      } finally { stopKeyCache(); rf(); }

      // 过期+7 天宽限内 → tier2.5 stale-grace
      writeFileSync(join(dir, 'config-cache.json'), JSON.stringify({
        keys: { deepseek: { api_key: 'sk-x' } }, defaultModel: 'GLM-5.3', strategy: null,
        refreshIntervalS: 900, fetchedAt: Date.now() - 48 * 3600_000, expiresAt: Date.now() - 24 * 3600_000,
      }));
      rf = bootFail();
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const d = describeConfig();
        assert.equal(d.fresh, false);
        assert.equal(d.staleGrace, true);
        assert.equal(d.effectiveSource, 'tier2-cache-stale-grace');
      } finally { stopKeyCache(); rf(); }

      // 过期超 7 天硬限 → getKeyCache 丢弃 → tier3
      writeFileSync(join(dir, 'config-cache.json'), JSON.stringify({
        keys: { deepseek: { api_key: 'sk-x' } }, defaultModel: 'GLM-5.3', strategy: null,
        refreshIntervalS: 900, fetchedAt: Date.now() - 9 * 24 * 3600_000, expiresAt: Date.now() - 8 * 24 * 3600_000,
      }));
      rf = bootFail();
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        const d = describeConfig();
        assert.equal(d.hasCache, false);
        assert.equal(d.effectiveSource, 'tier3-env');
      } finally { stopKeyCache(); rf(); }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifyPull 三查试跑不落盘：健康卡形态（零状态写入）+model-relay（decrypt=n/a）+pull_denied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n4-'));
    const restore = pinSandboxEnv();
    try {
      const healthy = async (): Promise<Response> => new Response(JSON.stringify({
        object: 'config.card-pull', face: 'rmc', card_present: true,
        default_model: 'deepseek-v4-pro', entries: pullEntriesFixture(),
        strategy: null, refresh_interval_s: 900,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      // boot 失败（无 cache 态）→ verify 走健康 mock
      const rf = withMockFetch(async () => new Response('{}', { status: 500 }));
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        // 形态①：健康卡
        const rv1 = withMockFetch(healthy);
        try {
          const beforeSt = getKeyCacheStatus();
          const v = await verifyPull();
          assert.equal(v.ok, true);
          assert.equal(v.connectivity, 'ok');
          assert.equal(v.credentials, 'ok');
          assert.equal(v.decryptHealth, 'ok');
          assert.equal(v.cardPresent, true);
          assert.ok(v.providers > 0);
          assert.equal(getKeyCacheStatus().lastFetchAt, beforeSt.lastFetchAt, 'verify 零状态写入（lastFetch 不动）');
          assert.ok(!existsSync(join(dir, 'config-cache.json')), 'verify 不落盘');
        } finally { rv1(); }
        // 形态②：model-relay
        const rv2 = withMockFetch(async () => new Response(JSON.stringify({
          object: 'config.card-pull', face: 'rmc', card_present: false,
          default_model: 'GLM-5.3', default_model_source: 'policy',
          entries: {}, strategy: null, refresh_interval_s: 900,
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        try {
          const v = await verifyPull();
          assert.equal(v.ok, true);
          assert.equal(v.cardPresent, false);
          assert.equal(v.decryptHealth, 'n/a');
          assert.equal(v.defaultModel, 'GLM-5.3');
        } finally { rv2(); }
        // 形态③：pull_denied
        const rv3 = withMockFetch(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
        try {
          const v = await verifyPull();
          assert.equal(v.ok, false);
          assert.equal(v.connectivity, 'ok', '401=连通正常凭据被拒');
          assert.equal(v.credentials, 'denied');
        } finally { rv3(); }
      } finally {
        rf();
        stopKeyCache();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clearKeyCache：canonical+legacy 双清（防 legacy 复活）+hadCache 读数', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-n4-'));
    const restore = pinSandboxEnv();
    try {
      // 先落 legacy 旧载体（模拟迁移前机器）
      writeFileSync(join(dir, 'keys.json'), JSON.stringify({
        keys: { deepseek: { api_key: 'sk-legacy' } }, defaultModel: 'old', strategy: null,
        refreshIntervalS: 900, fetchedAt: Date.now(), expiresAt: Date.now() + 3600_000,
      }));
      const rf = withMockFetch(async () => new Response('{}', { status: 500 }));
      try {
        await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
        assert.equal(getKeyCache()?.defaultModel, 'old', 'legacy fallback 在位');
        const r = clearKeyCache();
        assert.equal(r.cleared, true);
        assert.equal(r.hadCache, true);
        assert.ok(r.removedFiles.some((p) => p.endsWith('keys.json')), 'legacy 载体同清');
        assert.equal(getKeyCache(), null, '清除后 tier3');
        assert.ok(!existsSync(join(dir, 'keys.json')));
      } finally {
        rf();
        stopKeyCache();
      }
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── LG-058 N5 方案三：本地配置落地链（拉→落→效+落地回执回写）──

/** plan3 pull 载荷基座（local_config 维可覆写）。 */
function plan3PullPayload(localConfig: unknown): Record<string, unknown> {
  return {
    object: 'config_card_pull',
    face: FACE_ID,
    card_present: true,
    default_model: 'deepseek-v4-pro',
    entries: { e1: { provider: 'deepseek', model: 'deepseek-v4-pro', api_key: 'sk-p3', enabled: true, updated_at: '2026-10-06T01:00:00Z' } },
    strategy: null,
    refresh_interval_s: 900,
    local_config: localConfig,
  };
}

describe('LG-058 N5 plan3 本地配置落地链', () => {
  /** 沙箱：S3 存储态+TRIRMC_CONFIG_DIR 钉 tmp+admin token 在位（回写通）。 */
  function pinPlan3Env(dir: string): () => void {
    const restoreSandbox = pinSandboxEnv();
    const saved: Record<string, string | undefined> = {
      TRIRMC_CONFIG_DIR: process.env.TRIRMC_CONFIG_DIR,
    };
    process.env.TRIRMC_CONFIG_DIR = dir;
    process.env.TRIMODEL_ADMIN_TOKEN = 'tok-admin'; // pinSandboxEnv 已存原值，restore 时还原
    return () => {
      if (saved.TRIRMC_CONFIG_DIR === undefined) delete process.env.TRIRMC_CONFIG_DIR;
      else process.env.TRIRMC_CONFIG_DIR = saved.TRIRMC_CONFIG_DIR;
      restoreSandbox();
    };
  }

  it('pull 带 local_config → 落盘 settings.json + status 回写携落地回执（值面一致）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-p3a-'));
    const cfgDir = join(dir, 'cfg');
    const restore = pinPlan3Env(cfgDir);
    const statusBodies: Array<Record<string, unknown>> = [];
    const rf = withMockFetch(async (input, init) => {
      if (String(input).includes('/status')) {
        statusBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify(plan3PullPayload({
        version: 1, updated_at: '2026-10-06T01:00:00Z',
        items: { TRIRMC_CRON_ENABLED: 'false', OPENCLOW_GATEWAY_URL: 'ws://127.0.0.1:9999' },
      })), { status: 200 });
    });
    try {
      await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
      // 「落」值面验证：settings.json 实际内容与拉到的 items 逐键一致（方稿 §3.6 验收锚③）
      const onDisk = JSON.parse(readFileSync(join(cfgDir, 'settings.json'), 'utf-8')) as { items: Record<string, string> };
      assert.equal(onDisk.items.TRIRMC_CRON_ENABLED, 'false');
      assert.equal(onDisk.items.OPENCLOW_GATEWAY_URL, 'ws://127.0.0.1:9999');
      assert.equal(getKeyCache()?.localConfig?.version, 1, 'cache 落地版本推进');
      // 落地回执随 status 回写（对表 server lcReport 契约）
      const st = statusBodies[0] as { state?: string; local_config?: { version_applied?: number; write_result?: string; file?: string } };
      assert.equal(st.state, 'applied');
      assert.equal(st.local_config?.version_applied, 1);
      assert.equal(st.local_config?.write_result, 'ok');
      assert.ok(st.local_config?.file?.endsWith('settings.json'), '回执携落地文件路径');
    } finally {
      rf();
      stopKeyCache();
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同版本重拉不重写（幂等防抖，脏探针实证）；版本推进才落新表', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-p3b-'));
    const cfgDir = join(dir, 'cfg');
    const restore = pinPlan3Env(cfgDir);
    const payload = plan3PullPayload({
      version: 1, updated_at: '2026-10-06T01:00:00Z', items: { TRIRMC_CRON_ENABLED: 'false' },
    });
    const rf = withMockFetch(async (input) => {
      if (String(input).includes('/status')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    try {
      await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
      const settingsPath = join(cfgDir, 'settings.json');
      assert.equal(JSON.parse(readFileSync(settingsPath, 'utf-8') as string).items.TRIRMC_CRON_ENABLED, 'false');
      // 脏探针：同版本重拉若重写则脏态被抹——不抹=未重写
      writeFileSync(settingsPath, '{"dirty-probe":true}');
      payload.local_config = { version: 1, updated_at: '2026-10-06T02:00:00Z', items: { TRIRMC_CRON_ENABLED: 'true' } };
      await refreshNow();
      assert.equal(readFileSync(settingsPath, 'utf-8'), '{"dirty-probe":true}', '同版本不重写');
      // 版本推进 → 新表落地
      payload.local_config = { version: 2, updated_at: '2026-10-06T03:00:00Z', items: { TRIRMC_CRON_ENABLED: 'true' } };
      const r = await refreshNow();
      assert.equal(r.mode, 'full');
      assert.equal(JSON.parse(readFileSync(settingsPath, 'utf-8') as string).items.TRIRMC_CRON_ENABLED, 'true', '新版本落地');
      assert.equal(getKeyCache()?.localConfig?.version, 2);
    } finally {
      rf();
      stopKeyCache();
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('落盘失败：回执 write_result=failed+write_error 如实回写，缓存版本不推进=下轮重试', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-p3c-'));
    const cfgDir = join(dir, 'cfg');
    const restore = pinPlan3Env(cfgDir);
    mkdirSync(join(cfgDir, 'settings.json'), { recursive: true }); // settings.json 预置为目录 → rename 必败
    const statusBodies: Array<Record<string, unknown>> = [];
    const rf = withMockFetch(async (input, init) => {
      if (String(input).includes('/status')) {
        statusBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify(plan3PullPayload({
        version: 1, updated_at: '2026-10-06T01:00:00Z', items: { TRIRMC_CRON_ENABLED: 'false' },
      })), { status: 200 });
    });
    try {
      await initKeyCache('http://127.0.0.1:3333', dir, 'tok');
      assert.equal(getKeyCache()?.localConfig ?? null, null, '写失败缓存版本不推进');
      const st1 = statusBodies[0] as { local_config?: { version_applied?: number; write_result?: string; write_error?: string } };
      assert.equal(st1.local_config?.write_result, 'failed');
      assert.ok(st1.local_config?.write_error, 'write_error 如实附');
      assert.equal(st1.local_config?.version_applied, 1, '报尝试版本（与 failed 成对）');
      // 重试语义：版本未推进 → 同版本重拉仍尝试写（再次 failed 回执）
      await refreshNow();
      assert.equal(statusBodies.length >= 2, true);
      const st2 = statusBodies[statusBodies.length - 1] as { local_config?: { write_result?: string } };
      assert.equal(st2.local_config?.write_result, 'failed', '失败后下轮自动重试');
    } finally {
      rf();
      stopKeyCache();
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readEnv 叠加（效步）：settings 补 env 未钉位；env 钉定优先；cron 开关双源', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trirmc-kc-p3d-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      updated_at: '2026-10-06T01:00:00Z',
      items: { TRIRMC_PORT: '9001', TRIRMC_BRIDGE_CWD: '/srv/from-settings', TRIRMC_CRON_ENABLED: 'false' },
    }));
    const saved: Record<string, string | undefined> = {
      TRIRMC_CONFIG_DIR: process.env.TRIRMC_CONFIG_DIR,
      TRIRMC_PORT: process.env.TRIRMC_PORT,
      TRIRMC_BRIDGE_CWD: process.env.TRIRMC_BRIDGE_CWD,
      TRIRMC_CRON_ENABLED: process.env.TRIRMC_CRON_ENABLED,
    };
    process.env.TRIRMC_CONFIG_DIR = dir;
    delete process.env.TRIRMC_PORT;
    process.env.TRIRMC_BRIDGE_CWD = '/srv/env-pinned';
    delete process.env.TRIRMC_CRON_ENABLED;
    try {
      const env = readEnv();
      assert.equal(env.port, 9001, 'settings 补 env 未钉位');
      assert.equal(env.bridgeCwd, '/srv/env-pinned', 'env 钉定优先（settings 同键被盖）');
      assert.equal(env.cronEnabled, false, 'settings cron 开关生效');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
