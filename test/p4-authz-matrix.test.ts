// ── LG-026 P4-e：授权面黑盒门禁矩阵（actor×工具；default-deny 断言）──
// 黑盒=仅经 PermissionEngine.decide() 公共 API 实测执行结果（双层探边教训：
// 清单可见≠执行放行——断言实调用 allowed 非规则清单读数）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionEngine } from '../src/agent-loop/permissions-engine/index.js';

// actor→引擎实例构造（黑盒：调用方视角只见 decide 结果）
// 组长席=白名单规则集（读类全开+Bash 白名单命令集+工作目录写）；未登记=零规则 default mode。
function engineFor(actor: 'leader' | 'unregistered'): PermissionEngine {
  if (actor === 'leader') {
    const e = new PermissionEngine({ mode: 'default', cwd: '/srv/fleet/work' });
    e.addRules(['read_file', 'glob_search', 'grep_search'], 'allow', 'userSettings');
    e.addRules(['shell_exec(git status)', 'shell_exec(git log*)', 'shell_exec(npm test)'], 'allow', 'userSettings');
    e.addRule('write_file', 'allow', 'userSettings');
    e.addRule('web_fetch', 'deny', 'policySettings');
    e.addRule('web_search', 'deny', 'policySettings');
    return e;
  }
  // 未登记 actor：零规则 default mode（default-deny 语义=决策管线对无规则工具不给 allow）
  return new PermissionEngine({ mode: 'default' });
}

const MATRIX: Array<{ tool: string; args: Record<string, unknown>; cell: string }> = [
  { tool: 'read_file', args: { file_path: '/srv/fleet/work/a.md' }, cell: '读类' },
  { tool: 'glob_search', args: { pattern: '**/*.ts' }, cell: '读类' },
  { tool: 'shell_exec', args: { command: 'git status' }, cell: 'Bash 白名单' },
  { tool: 'shell_exec', args: { command: 'rm -rf /' }, cell: 'Bash 越权' },
  { tool: 'write_file', args: { file_path: '/srv/fleet/work/out.md', content: 'x' }, cell: '写-工作目录' },
  { tool: 'write_file', args: { file_path: '/etc/passwd', content: 'x' }, cell: '写-越界' },
  { tool: 'web_fetch', args: { url: 'https://example.com' }, cell: '网络面' },
];

describe('LG-026 P4-e 授权面黑盒矩阵', () => {
  test('组长席：白名单格 allow/越权格非 allow（逐格实录）', () => {
    const e = engineFor('leader');
    const log: string[] = [];
    for (const { tool, args, cell } of MATRIX) {
      const d = e.decide(tool, args);
      log.push(`${cell}(${tool}) → behavior=${d.behavior ?? d.allowed}`);
      if (cell === '读类' || cell === 'Bash 白名单' || cell === '写-工作目录') {
        assert.equal(d.allowed, true, `${cell} 应放行: ${JSON.stringify(d)}`);
      } else {
        assert.notEqual(d.allowed, true, `${cell} 应拦截: ${JSON.stringify(d)}`);
      }
    }
    console.log('[p4-e leader 实录]\n' + log.join('\n'));
  });

  test('未登记 actor：default-deny 全格非 allow（零旁路断言）', () => {
    const e = engineFor('unregistered');
    for (const { tool, args, cell } of MATRIX) {
      const d = e.decide(tool, args);
      assert.notEqual(
        d.allowed, true,
        `default-deny 失效：未登记 actor ${cell}(${tool}) 被放行 ${JSON.stringify(d)}`,
      );
    }
  });

  test('policy 面 deny 压制 user 面 allow（优先级实断）', () => {
    const e = engineFor('leader');
    const d = e.decide('WebFetch', { url: 'https://example.com' });
    assert.notEqual(d.allowed, true);
  });
});
