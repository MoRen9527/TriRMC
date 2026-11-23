// DP-20261123-032（D-91 链跑期禁推）：链跑态 marker 白盒——写/删/pid 归属/stale 三态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeChainMarker, clearChainMarker, isChainRunning, CHAIN_MARKER_STALE_MS } from '../../src/fade001/chain_marker.js';

function withMarkerPath(fn: () => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'dp032-'));
  const old = process.env.TRI_CHAIN_MARKER;
  process.env.TRI_CHAIN_MARKER = path.join(dir, 'chain-running.marker');
  try {
    fn();
  } finally {
    if (old === undefined) delete process.env.TRI_CHAIN_MARKER; else process.env.TRI_CHAIN_MARKER = old;
  }
}

test('DP-032 marker 写→running·clear→absent（pid 归属本进程）', () => {
  withMarkerPath(() => {
    assert.equal(writeChainMarker('run-42'), true);
    const st = isChainRunning();
    assert.equal(st.state, 'running');
    assert.equal(st.marker?.runId, 'run-42');
    assert.equal(st.marker?.pid, process.pid);
    assert.equal(clearChainMarker(), true);
    assert.equal(isChainRunning().state, 'absent');
  });
});

test('DP-032 他进程 marker 不删（pid 归属比对）', () => {
  withMarkerPath(() => {
    writeChainMarker('run-x');
    const p = process.env.TRI_CHAIN_MARKER as string;
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    doc.pid = process.pid + 99999;             // 伪造他链
    writeFileSync(p, JSON.stringify(doc), 'utf8');
    assert.equal(clearChainMarker(), false);
    assert.equal(isChainRunning().state, 'running');
  });
});

test('DP-032 stale>2h 保护：超窗标记 stale（闸端放行+告警面）', () => {
  withMarkerPath(() => {
    writeChainMarker('run-old');
    const p = process.env.TRI_CHAIN_MARKER as string;
    const old = (Date.now() - CHAIN_MARKER_STALE_MS - 60_000) / 1000;
    utimesSync(p, old, old);                   // mtime 拨到 2h+ 前
    const st = isChainRunning();
    assert.equal(st.state, 'stale');
    assert.equal(st.marker?.runId, 'run-old');
  });
});

test('DP-032 absent 态：无 marker=放行面', () => {
  withMarkerPath(() => {
    assert.equal(isChainRunning().state, 'absent');
    assert.equal(existsSync(process.env.TRI_CHAIN_MARKER as string), false);
  });
});

// ── R 形（跨机 ref marker·CTO 裁 2026-11-23）──
import { execFileSync } from 'node:child_process';
import { writeChainMarkerRef, clearChainMarkerRef, chainRefInfo, CHAIN_MARKER_REF } from '../../src/fade001/chain_marker.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
}

function mkRepoPair(): { repo: string; bare: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'dp032r-'));
  const repo = path.join(base, 'repo');
  const bare = path.join(base, 'bare.git');
  execFileSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  writeFileSync(path.join(repo, 'a.txt'), 'x');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'init']);
  execFileSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
  git(repo, ['remote', 'add', 'origin', bare]);
  return { repo, bare };
}

test('DP-032 R 形：push marker ref → bare 可见 running·消息含 runId·delete 后 absent', () => {
  const { repo, bare } = mkRepoPair();
  assert.equal(writeChainMarkerRef(repo, 'r-ref-1'), true);
  const info = chainRefInfo(bare);
  assert.equal(info.state, 'running');
  assert.ok(String(info.raw).includes('r-ref-1'));
  assert.equal(clearChainMarkerRef(repo), true);
  assert.equal(chainRefInfo(bare).state, 'absent');
  assert.equal(execFileSync('git', ['for-each-ref', CHAIN_MARKER_REF], { cwd: bare, encoding: 'utf8' }).trim(), '');
});

test('DP-032 R 形：push 失败=返回 false（fail-open 面）', () => {
  const { repo } = mkRepoPair();
  git(repo, ['remote', 'set-url', 'origin', '/nonexistent/bare.git']);
  assert.equal(writeChainMarkerRef(repo, 'r-fail'), false);
});
