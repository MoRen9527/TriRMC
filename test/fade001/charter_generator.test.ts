/**
 * 任务书生成器白盒（COS 主笔·P4 直接启用形·CTO 卷 be7afadff）
 * 覆盖：五字段全齐通过 / 缺 target·verify·rollback 各自退回 / 空 opinions 退回
 *       / auto_dispatch 默认不置+显式授予 / approver 分配 / charter_id 形 / schema 版本透传
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHARTER_SCHEMA_VERSION,
  generateCharter,
  generateCharterFromFile,
  type OpinionsDoc,
} from '../../src/fade001/charter_generator.ts';

function okOpinion(id: string) {
  return {
    opinion_id: id,
    title: `改造项 ${id}`,
    target: 'src/fade001/round_runner.ts',
    change: '改什么·具体动作',
    verify: '验收判据·可机械复算',
    rollback: '回滚锚·基线 commit + revert 动作',
    seat: 'cto',
  };
}

const baseDoc = (opinions: unknown[]): OpinionsDoc => ({
  schema_version: '1.0.0',
  run_id: 'run-20261121-01',
  round: 9,
  opinions: opinions as OpinionsDoc['opinions'],
});

describe('charter_generator', () => {
  it('五字段全齐 → 生成 pending_approval 任务书', () => {
    const res = generateCharter(baseDoc([okOpinion('R9-CTO-01'), okOpinion('R9-COO-01')]), {
      date: '20261121',
    });
    assert.equal(res.ok, true);
    assert.equal(res.rejects.length, 0);
    const c = res.charter!;
    assert.equal(c.schema_version, CHARTER_SCHEMA_VERSION);
    assert.equal(c.charter_id, 'r9-task-20261121');
    assert.equal(c.status, 'pending_approval');
    assert.equal(c.approver_pending, 'CEO'); // debug 链默认 CEO 批
    assert.equal(c.items.length, 2);
    assert.equal(c.source.run_id, 'run-20261121-01');
    assert.deepEqual(c.source.opinion_ids, ['R9-CTO-01', 'R9-COO-01']);
  });

  it('缺 target → 整卷退回人工（fail-closed）', () => {
    const bad = { ...okOpinion('R9-X-01'), target: '' };
    const res = generateCharter(baseDoc([okOpinion('R9-CTO-01'), bad]), { date: '20261121' });
    assert.equal(res.ok, false);
    assert.equal(res.rejects.length, 1);
    assert.deepEqual(res.rejects[0].missing, ['target']);
    assert.equal(res.charter, undefined);
    assert.match(res.reason ?? '', /退回人工/);
  });

  it('缺 verify → 退回人工', () => {
    const bad = { ...okOpinion('R9-X-02'), verify: undefined };
    const res = generateCharter(baseDoc([bad]), { date: '20261121' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.rejects[0].missing, ['verify']);
  });

  it('缺 rollback → 退回人工', () => {
    const bad = { ...okOpinion('R9-X-03'), rollback: null };
    const res = generateCharter(baseDoc([bad]), { date: '20261121' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.rejects[0].missing, ['rollback']);
  });

  it('空 opinions → 退回', () => {
    const res = generateCharter(baseDoc([]), { date: '20261121' });
    assert.equal(res.ok, false);
    assert.match(res.reason ?? '', /空/);
  });

  it('auto_dispatch 默认不置（红线二脚本兜死）·显式授予才 true', () => {
    const r1 = generateCharter(baseDoc([okOpinion('R9-CTO-01')]), { date: '20261121' });
    assert.equal(r1.ok, true);
    assert.equal('auto_dispatch' in (r1.charter as object), false);
    assert.equal(r1.charter!.auto_dispatch, undefined);

    const r2 = generateCharter(baseDoc([okOpinion('R9-CTO-01')]), { date: '20261121', autoDispatch: true });
    assert.equal(r2.charter!.auto_dispatch, true);
  });

  it('approver 分配：debug 链默认 CEO·test/prod 代批传 COS', () => {
    const r1 = generateCharter(baseDoc([okOpinion('R9-CTO-01')]), { date: '20261121' });
    assert.equal(r1.charter!.approver_pending, 'CEO');
    const r2 = generateCharter(baseDoc([okOpinion('R9-CTO-01')]), { date: '20261121', approver: 'COS' });
    assert.equal(r2.charter!.approver_pending, 'COS');
  });

  it('文件不存在 → 退回（不抛）', () => {
    const res = generateCharterFromFile('Z:/definitely-not-exists/opinions.json');
    assert.equal(res.ok, false);
    assert.match(res.reason ?? '', /不存在/);
  });

  it('round 缺省 → charter_id rN 形', () => {
    const doc = { opinions: [okOpinion('R9-CTO-01')] } as OpinionsDoc;
    const res = generateCharter(doc, { date: '20261121' });
    assert.equal(res.ok, true);
    assert.equal(res.charter!.charter_id, 'rN-task-20261121');
  });
});
