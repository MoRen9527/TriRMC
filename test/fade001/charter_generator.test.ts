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

  it('v8 item12 全纳：每席直提条数不限（7 件全进·dropped=去重合并报告）', () => {
    const ops = [];
    for (let i = 0; i < 6; i += 1) ops.push(okOpinion(`R10-N-0${i}`));
    const dup = { ...okOpinion('R10-N-00'), opinion_id: 'R10-DUP-01' };   // 同 title+target 重复件
    const res = generateCharter(baseDoc([...ops, dup]), { date: '20261124' });
    assert.equal(res.ok, true);
    const agg = (res.charter as unknown as { aggregation: { items_included: number; dropped: Array<{ opinion_id: string; title: string }> } }).aggregation;
    assert.equal(res.charter!.items.length, 6);                // 全纳（去重后 6·非前 5）
    assert.equal(agg.items_included, 6);
    assert.equal(agg.dropped.length, 1);                       // 仅去重合并报告
    assert.equal(agg.dropped[0].opinion_id, 'R10-DUP-01');     // 可溯源二字段
    assert.ok(agg.dropped[0].title);
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

  it('两形兼容 B 形：per-seat 文件 face.improvements → 提取为 items（CTO 令 2026-11-25）', () => {
    const faceDoc = {
      schema_version: '1.0.0',
      run_id: 'run-20261125-01',
      seat: 'cto',
      face: {
        dimensions: [{ dimension: 'd1', score: 40 }],
        improvements: [
          { title: 'T-A', target: 'src/a.ts', change: 'c1', verify: 'v1', rollback: 'r1' },
          { title: 'T-B', target: 'src/b.ts', change: 'c2', verify: 'v2', rollback: 'r2' },
        ],
        violations: [],
      },
    };
    const res = generateCharter(faceDoc as unknown as OpinionsDoc, { date: '20261125' });
    assert.equal(res.ok, true);
    assert.equal(res.charter?.items.length, 2);          // 2 条提取
    assert.equal(res.charter?.items[0].owner_seat, 'cto'); // seat 透传
  });

  it('两形兼容 A 形：doc.opinions 数组照旧（回归）', () => {
    const res = generateCharter(baseDoc([okOpinion('R9-CTO-01')]), { date: '20261125' });
    assert.equal(res.ok, true);
    assert.equal(res.charter?.items.length, 1);
  });


  it('T1a：七席溯源保留——14 条逐改善条目化输入 → items 各带 owner_seat（非合订）', () => {
    const seats = ['cos', 'coo', 'cao', 'cpo', 'cto', 'cho', 'cfo'];
    const ops = seats.flatMap((s) => [
      { ...okOpinion(`${s}-0`), owner_seat: s },
      { ...okOpinion(`${s}-1`), title: `${s} 第二项`, owner_seat: s },
    ]);
    const res = generateCharter(baseDoc(ops), { date: '20261125' });
    assert.equal(res.ok, true);
    assert.equal(res.charter?.items.length, 14);
    assert.deepEqual([...new Set(res.charter?.items.map((i) => i.owner_seat))].sort(), seats.sort());
  });


  it('④CEO 新令：只含待办——fixed 不收·carried 禁入·excluded_status 留痕', () => {
    const ops = [
      { ...okOpinion('p-fixed'), status: 'fixed' },
      { ...okOpinion('p-carried'), status: 'carried' },
      { ...okOpinion('p-defer'), status: 'deferred' },
      { ...okOpinion('p-new') },
    ];
    const res = generateCharter(baseDoc(ops), { date: '20261126' });
    assert.equal(res.ok, true);
    assert.equal(res.charter?.items.length, 2);                       // deferred + new
    const agg = (res.charter as unknown as Record<string, unknown>).aggregation as
      { excluded_status?: Array<{ status: string }> } | undefined;
    assert.equal(agg?.excluded_status?.length, 2);
    assert.deepEqual((agg?.excluded_status ?? []).map((x) => x.status).sort(), ['carried', 'fixed']);
  });


  it('S3-1：低分维度→能力项（量化+measurement·target 阶梯）', () => {
    const faces = {
      cos: { dimensions: [
        { dimension_id: 'migrate_accuracy', object: 'a', score: 40 },
        { dimension_id: 'good_dim', object: 'a', score: 90 }] },
      coo: { dimensions: [
        { dimension_id: 'migrate_accuracy', object: 'a', score: 44 }] },
    };
    const res = generateCharter(baseDoc([okOpinion('p1'), okOpinion('p2')]),
      { date: '20261126', faces } as never);
    assert.equal(res.ok, true);
    const caps = (res.charter?.items ?? []).filter((i) => (i as Record<string, unknown>).capability);
    assert.equal(caps.length, 1);                                  // 只低分维出项（<70）
    const cap = caps[0] as Record<string, unknown>;
    assert.equal(cap.dimension_id, 'migrate_accuracy');
    assert.equal(cap.current_score, 42);                           // (40+44)/2
    assert.equal(cap.target_score, 70);                            // <60 阶梯→70
    assert.ok(String(cap.measurement ?? '').includes('均分'));      // measurement 必填
    const agg = (res.charter as unknown as Record<string, unknown>).aggregation as
      Record<string, unknown>;
    assert.ok(Number(agg.capability_ratio) >= 0.3);                // 1 cap / 4 items?=0.25→见下
  });

  it('S3-1：能力项占比 <30% → ok=false（合规清单不合格）', () => {
    const many = Array.from({ length: 10 }, (_, i) => okOpinion(`t-${i}`));
    const faces = { cos: { dimensions: [
      { dimension_id: 'low1', object: 'a', score: 30 }] } };
    const res = generateCharter(baseDoc(many), { date: '20261126', faces } as never);
    assert.equal(res.ok, false);
    assert.match(String(res.reason), /能力项占比/);
  });


  it('S2-1：<40 暴露项自动入任务书（席级·dimension_id+low_reason·target 60）', () => {
    const faces = { cos: { dimensions: [
      { dimension_id: 'migrate_accuracy', object: 'a', score: 36 }] } };
    const res = generateCharter(baseDoc([okOpinion('p1'), okOpinion('p2')]),
      { date: '20261126', faces } as never);
    assert.equal(res.ok, true);
    const exps = (res.charter?.items ?? []).filter((i) => (i as Record<string, unknown>).exposure);
    assert.equal(exps.length, 1);
    const e = exps[0] as Record<string, unknown>;
    assert.equal(e.seat, 'cos');
    assert.equal(e.dimension_id, 'migrate_accuracy');
    assert.equal(e.target_score, 60);
    assert.ok(String(e.low_reason ?? '').includes('36'));
  });

});
