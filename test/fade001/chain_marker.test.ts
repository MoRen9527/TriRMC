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
