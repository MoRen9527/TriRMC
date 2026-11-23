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
    owner_seat: 'cto',   // T1/R5 六字段
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

describe('owner_seat（R10-CHO-01）', () => {
  it('owner_seat 非空 → 透传至 charter item', () => {
    const op = { ...okOpinion('R10-CTO-01'), owner_seat: 'cto' };
    const res = generateCharter(baseDoc([op]), { date: '20261123' });
    assert.equal(res.ok, true);
    assert.equal((res.charter!.items[0] as { owner_seat?: string }).owner_seat, 'cto');
  });
  it('owner_seat 缺 → 六字段强制后拒（T1/R5·原可选面退役）', () => {
    const op = { ...okOpinion('R10-CTO-02') } as Record<string, unknown>;
    delete op.owner_seat;
    const res = generateCharter(baseDoc([op]), { date: '20261123' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.rejects[0].missing, ['owner_seat']);
  });
});

describe('T1②（charter v2）六字段/归并≤5/覆盖两级', () => {
  it('owner_seat 缺 → 整卷退回（六字段强制）', () => {
    const bad = { ...okOpinion('R10-X-01') } as Record<string, unknown>;
    delete bad.owner_seat;
    const res = generateCharter(baseDoc([okOpinion('R10-CTO-01'), bad]), { date: '20261124' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.rejects[0].missing, ['owner_seat']);
  });

  it('族归并≤5：同 title+target 去重·超 5 截断留痕', () => {
    const ops = [];
    for (let i = 0; i < 6; i += 1) ops.push(okOpinion(`R10-N-0${i}`));
    // 同 title+target 重复件（与首件同标题·模拟族内重复意见）→ 去重
    const dup = { ...okOpinion('R10-N-00'), opinion_id: 'R10-DUP-01' };
    const res = generateCharter(baseDoc([...ops, dup]), { date: '20261124' });   // 7 件→去重 6→截 5
    assert.equal(res.ok, true);
    const agg = (res.charter as unknown as { aggregation: { items_included: number; dropped: string[] } }).aggregation;
    assert.equal(res.charter!.items.length, 5);
    assert.equal(agg.items_included, 5);
    assert.equal(agg.dropped.length, 1);                       // 7-去重1-截5=1
  });

  it('低分维未覆盖：lenient=warn 仍生成·strict=拒', () => {
    const doc = baseDoc([okOpinion('R10-CTO-01')]);
    (doc.opinions[0] as Record<string, unknown>).scores = { anchor_1_dim: 40 };
    const old = process.env.TRICO_COVERAGE_GATE;
    try {
      delete process.env.TRICO_COVERAGE_GATE;
      const len = generateCharter(doc, { date: '20261124' });
      assert.equal(len.ok, true);                              // lenient：告警可见（stderr）仍过
      process.env.TRICO_COVERAGE_GATE = 'strict';
      const st = generateCharter(doc, { date: '20261124' });
      assert.equal(st.ok, false);
      assert.match(st.reason ?? '', /低分维未覆盖/);
    } finally {
      if (old === undefined) delete process.env.TRICO_COVERAGE_GATE;
      else process.env.TRICO_COVERAGE_GATE = old;
    }
  });
});
