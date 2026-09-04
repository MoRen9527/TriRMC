// ── LG-017 pre-receive 三闸 sandbox 测试（临时 bare 仓 fixture，零网络）──
// 覆盖：拒因四码正负路径+身份矩阵三分法+dev 双条件+tag 保护。
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '../../hooks/pre-receive');

interface Fixture {
  bare: string;
  work: string;
  cleanup: () => void;
}

function makeBareWithCommits(): Fixture {
  const td = mkdtempSync(join(tmpdir(), 'lg017-'));
  const bare = join(td, 'repo.git');
  const work = join(td, 'work');
  execFileSync('git', ['init', '--bare', '-q', bare]);
  // hook 安装（P-a 形态：bare 仓 hooks/pre-receive 挂点）
  const hookDst = join(bare, 'hooks', 'pre-receive');
  copyFileSync(HOOK, hookDst);
  chmodSync(hookDst, 0o755);
  execFileSync('git', ['init', '-q', '-b', 'dev', work]);
  execFileSync('git', ['-C', work, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 't']);
  execFileSync('git', ['-C', work, 'config', 'commit.gpgsign', 'false']);
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '-q', '-m', 'base']);
  execFileSync('git', ['-C', work, 'push', '-q', bare, 'dev:dev'], {
    env: { ...process.env, GIT_PUSH_USER: 'MoRen', GIT_COMMITTER_NAME: 'MoRen', GIT_COMMITTER_EMAIL: 'MoRen@t', GIT_AUTHOR_NAME: 'MoRen', GIT_AUTHOR_EMAIL: 'MoRen@t' },
  });
  return {
    bare, work,
    cleanup: () => rmSync(td, { recursive: true, force: true }),
  };
}

/** 向 bare 推送（经 hook）：返回 {rc, stderr}。 */
function pushThroughHook(
  fx: Fixture,
  pusher: string,
  refspec: string,
  opts: { force?: boolean; makeCommit?: boolean } = {},
): { rc: number; stderr: string } {
  if (opts.makeCommit) {
    execFileSync('git', ['-C', fx.work, 'commit', '--allow-empty', '-q', '-m', `c-${Date.now()}-${Math.random()}`]);
  }
  const args = ['push', fx.bare, refspec];
  if (opts.force) args.push('--force');
  const res = spawnSync('git', ['-C', fx.work, ...args], {
    env: {
      ...process.env,
      GIT_PUSH_USER: pusher,
      GIT_COMMITTER_NAME: pusher,
      GIT_COMMITTER_EMAIL: `${pusher}@t`,
      GIT_AUTHOR_NAME: pusher,
      GIT_AUTHOR_EMAIL: `${pusher}@t`,
    },
    encoding: 'utf-8',
  });
  // hook stderr 经 remote 行回传
  const stderr = `${res.stderr}\n${res.stdout}`;
  return { rc: res.status ?? 1, stderr };
}

function hookDirect(fx: Fixture, pusher: string, oldrev: string, newrev: string, refname: string): { rc: number; stderr: string } {
  // 显式 Git Bash（PATH 的 bash=WSL System32 bash.exe，MSYS 路径形态不兼容）
  const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const msysHook = HOOK.replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
  const res = spawnSync(GIT_BASH, [msysHook], {
    input: `${oldrev} ${newrev} ${refname}\n`,
    cwd: fx.bare,
    env: { ...process.env, GIT_PUSH_USER: pusher },
    encoding: 'utf-8',
  });
  return { rc: res.status ?? 1, stderr: res.stderr };
}

describe('LG-017 pre-receive 三闸 sandbox', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeBareWithCommits(); });
  test('闸2 身份 fail-closed：未登记身份拒 identity_not_allowed', () => {
    fx.work && execFileSync('git', ['-C', fx.work, 'commit', '--allow-empty', '-q', '-m', 'x']);
    const { rc, stderr } = pushThroughHook(fx, 'ghost', 'dev:dev');
    assert.notEqual(rc, 0);
    assert.match(stderr, /identity_not_allowed/);
  });

  test('闸1 防force-push：non-fast-forward 拒 force_push_denied', () => {
    // 先推两提交，再回退本地一笔 force 推
    pushThroughHook(fx, 'MoRen', 'dev:dev', { makeCommit: true });
    pushThroughHook(fx, 'MoRen', 'dev:dev', { makeCommit: true });
    execFileSync('git', ['-C', fx.work, 'reset', '-q', '--hard', 'HEAD~1']);
    const { rc, stderr } = pushThroughHook(fx, 'MoRen', '+dev:dev', { force: true });
    assert.notEqual(rc, 0);
    assert.match(stderr, /force_push_denied/);
    assert.doesNotMatch(stderr, /branch_protected/);
  });

  test('闸1 分支删除拒 force_push_denied', () => {
    pushThroughHook(fx, 'MoRen', 'dev:docs/tmp', { makeCommit: true });
    const { rc, stderr } = pushThroughHook(fx, 'MoRen', ':docs/tmp');
    assert.notEqual(rc, 0);
    assert.match(stderr, /force_push_denied/);
  });

  test('闸2 矩阵：fleet 推 deploy 系过/推 dev 拒 branch_protected', () => {
    const ok = pushThroughHook(fx, 'fleet', 'dev:deploy/x', { makeCommit: true });
    assert.equal(ok.rc, 0, ok.stderr);
    const denied = pushThroughHook(fx, 'fleet', 'dev:dev', { makeCommit: true });
    assert.notEqual(denied.rc, 0);
    assert.match(denied.stderr, /branch_protected/);
  });

  test('dev 主分支保护：MoRen fast-forward 过（白名单+ff 双条件）', () => {
    const { rc, stderr } = pushThroughHook(fx, 'MoRen', 'dev:dev', { makeCommit: true });
    assert.equal(rc, 0, stderr);
  });

  test('闸3 tag 保护：v* 非授权身份拒 tag_protected', () => {
    execFileSync('git', ['-C', fx.work, 'tag', 'v1.0.0-test']);
    const { rc, stderr } = pushThroughHook(fx, 'fleet', 'v1.0.0-test:v1.0.0-test');
    assert.notEqual(rc, 0);
    assert.match(stderr, /tag_protected/);
  });

  test('闸3 tag：MoRen 建 v* 过+删 tag 拒 tag_protected（direct 喂参）', () => {
    const newrev = execFileSync('git', ['-C', fx.bare, 'rev-parse', 'dev'], { encoding: 'utf-8' }).trim();
    const ok = hookDirect(fx, 'MoRen', '0000000000000000000000000000000000000000', newrev, 'refs/tags/v2.0.0');
    assert.equal(ok.rc, 0, ok.stderr);
    const del = hookDirect(fx, 'MoRen', newrev, '0000000000000000000000000000000000000000', 'refs/tags/v2.0.0');
    assert.notEqual(del.rc, 0);
    assert.match(del.stderr, /tag_protected/);
  });
});
