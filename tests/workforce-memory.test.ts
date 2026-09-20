import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Workforce,
  MemoryWorker,
  explicitExtractor,
  type TurnInput,
  type Memory,
  type Job,
} from '../src/workforce/domain.ts';

const admin = { id: 'admin', role: 'admin' } as const;
function setup(path = ':memory:') {
  let now = 1000;
  const w = new Workforce(path, () => now);
  const e = w.createEmployee(admin, { name: '测试员工' });
  w.publish(admin, e.id, 1);
  const p = w.createProject(admin, { name: '项目一', managers: ['pm'] });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'a', sharedWith: ['b'] });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'b', sharedWith: ['a'] });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'external', sharedWith: [] });
  let serial = 0;
  const input = (chat = 'a', text = '确认决策：交付日期=10月15日'): TurnInput => ({
    employeeId: e.id,
    chatId: chat,
    userId: 'u',
    messageId: String(++serial),
    text,
    direct: false,
  });
  const turn = (chat = 'a', text?: string) => {
    const t = w.beginTurn(input(chat, text));
    w.finishTurn(t.id, 'idle', 'ma-session');
    return t;
  };
  return {
    w,
    e,
    p,
    input,
    turn,
    advance: (ms: number) => {
      now += ms;
    },
    worker: new MemoryWorker(w),
  };
}
test('连续空闲至少30秒才提炼；授权群可读并追溯，外部群和其他项目隔离', async () => {
  const { w, e, turn, advance, worker } = setup();
  const source = turn();
  await worker.tick();
  advance(29999);
  await worker.tick();
  assert.equal(w.all('memory').length, 0);
  advance(1);
  await worker.tick();
  const m = w.readMemories(w.binding(e.id, 'b')!)[0];
  assert.equal(m.value, '10月15日');
  assert.deepEqual(m.sourceIds, [source.id]);
  assert.equal(w.readMemories(w.binding(e.id, 'external')!).length, 0);
  const p2 = w.createProject(admin, { name: '其他项目' });
  w.bind(admin, { employeeId: e.id, projectId: p2.id, chatId: 'other', sharedWith: ['a'] });
  assert.equal(w.readMemories(w.binding(e.id, 'other')!).length, 0);
  w.close();
});
test('30秒内有新消息或等待授权不提炼；恢复空闲后重新计时', async () => {
  const { w, turn, advance, worker, input } = setup();
  turn();
  await worker.tick();
  advance(20000);
  const next = input();
  w.enqueue(next);
  advance(40000);
  await worker.tick();
  assert.equal(w.all('memory').length, 0);
  const t = w.beginTurn(next);
  w.finishTurn(t.id, 'waiting');
  advance(60000);
  await worker.tick();
  assert.equal(w.all('memory').length, 0);
  w.finishTurn(t.id, 'idle');
  advance(30000);
  await worker.tick();
  assert.equal(w.all('memory').length, 1);
  w.close();
});
test('并行群事实保留；同键矛盾标记冲突，项目管理员处理后新轮可见', async () => {
  const { w, e, turn, advance, worker } = setup();
  turn('a');
  turn('b', '确认决策：交付日期=10月16日\n确认事实：负责人=王工');
  await worker.tick();
  advance(30000);
  await worker.tick();
  assert.equal(w.all<Memory>('memory').filter((m) => m.status === 'conflict').length, 2);
  assert.equal(w.readMemories(w.binding(e.id, 'a')!).find((m) => m.key === '负责人')?.value, '王工');
  const selected = w.all<Memory>('memory').find((m) => m.value === '10月16日')!;
  w.editMemory({ id: 'pm', role: 'project_admin' }, selected.id, 'resolve', { revision: selected.revision });
  assert.equal(w.readMemories(w.binding(e.id, 'a')!).find((m) => m.key === '交付日期')?.value, '10月16日');
  w.close();
});
test('后台冻结范围不包含新轮；同毫秒新事件不丢失；重复提交幂等', async () => {
  const { w, turn, advance } = setup();
  const t = turn();
  const [j] = w.planJobs();
  advance(30000);
  w.claimJob(j.id);
  turn('a', '确认事实：目标=发布');
  w.commitJob(j.id, explicitExtractor([t]));
  w.commitJob(j.id, explicitExtractor([t]));
  assert.equal(w.all('memory').length, 1);
  const [next] = w.planJobs();
  assert.equal(next.sourceIds.length, 1);
  w.close();
});
test('群换绑或撤权后旧任务暂停，不向新项目写入；历史记忆也不可继续跨群读取', async () => {
  const { w, e, p, turn, advance, worker } = setup();
  turn();
  await worker.tick();
  advance(30000);
  await worker.tick();
  turn('a', '确认事实：目标=增加销量');
  const [j] = w.planJobs();
  advance(30000);
  w.claimJob(j.id);
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'a', sharedWith: [] });
  w.commitJob(j.id, explicitExtractor(j.sourceIds.map((id) => w.get('turn', id)!)));
  assert.equal(w.get<Job>('job', j.id)?.state, 'paused');
  assert.equal(w.readMemories(w.binding(e.id, 'b')!).length, 0);
  w.close();
});
test('私聊、个人日历、未确认建议及聊天越权指令不能成为项目记忆', async () => {
  const { w, input, turn, advance, worker } = setup();
  turn('a', '建议日期10月15日');
  turn('b', '确认事实：api_key=private');
  const t = w.beginTurn({ ...input(), direct: true });
  w.finishTurn(t.id, 'idle');
  await worker.tick();
  advance(30000);
  await worker.tick();
  assert.equal(w.all('memory').length, 0);
  w.close();
});
test('提炼输出来源造假整体回滚，游标不推进', () => {
  const { w, turn, advance } = setup();
  const t = turn();
  const [j] = w.planJobs();
  advance(30000);
  w.claimJob(j.id);
  assert.throws(
    () => w.commitJob(j.id, [{ key: '交付日期', value: '10月20日', kind: 'decision', sourceIds: [t.id] }]),
    /确认/,
  );
  assert.equal(w.activity(t.sessionKey).cursor, 0);
  assert.equal(w.all('memory').length, 0);
  w.close();
});
test('进程重启恢复固定任务且已提交任务不重复写', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workforce-'));
  const path = join(dir, 'test.db');
  const { w, turn, advance } = setup(path);
  const t = turn();
  const [j] = w.planJobs();
  advance(30000);
  w.claimJob(j.id);
  w.close();
  const restored = new Workforce(path, () => 50000);
  restored.recoverJobs();
  assert.equal(restored.claimJob(j.id)?.id, j.id);
  restored.commitJob(j.id, explicitExtractor([t]));
  restored.close();
  const reopened = new Workforce(path);
  reopened.recoverJobs();
  assert.equal(reopened.all('memory').length, 1);
  assert.equal(reopened.get<Job>('job', j.id)?.state, 'completed');
  reopened.close();
  rmSync(dir, { recursive: true });
});
test('规则候选需审批，失败重试有界；关闭自动提炼保留已有记忆', async () => {
  const { w, e, p, turn, advance, worker } = setup();
  turn('a', '确认规则：交付审核=先由项目经理审核');
  await worker.tick();
  advance(30000);
  await worker.tick();
  const m = w.all<Memory>('memory')[0];
  assert.equal(m.status, 'pending_approval');
  assert.equal(w.readMemories(w.binding(e.id, 'a')!).length, 0);
  w.editMemory(admin, m.id, 'approve', { revision: m.revision });
  w.updateProject(admin, p.id, { extractionEnabled: false });
  assert.equal(w.readMemories(w.binding(e.id, 'a')!).length, 1);
  w.close();
});
test('长期文件索引在撤权后失效，不把Session沙箱路径当长期资料', () => {
  const { w, e, p } = setup();
  const binding = w.binding(e.id, 'a')!;
  assert.throws(
    () =>
      w.registerResource(admin, {
        projectId: p.id,
        bindingId: binding.id,
        name: 'PDF',
        uri: '/mnt/data/file.pdf',
      }),
    /地址/,
  );
  const resource = w.registerResource(admin, {
    projectId: p.id,
    bindingId: binding.id,
    name: '项目Brief',
    uri: 'https://example.test/controlled/document',
  });
  assert.equal(w.readMemories(w.binding(e.id, 'b')!).length, 1);
  w.revokeResource(admin, resource.id);
  assert.equal(w.readMemories(w.binding(e.id, 'b')!).length, 0);
  w.close();
});
test('普通记忆读取失败允许降级，强制发布规则不可用时拒绝开始轮次', () => {
  const { w, e, input } = setup();
  w.readMemories = () => {
    throw new Error('记忆服务故障');
  };
  const turn = w.beginTurn(input());
  assert.equal(turn.memories.length, 0);
  assert.match(turn.error!, /暂不可用/);
  const employee = w.employee(e.id);
  employee.releaseId = 'missing';
  w.put('employee', employee);
  assert.throws(() => w.beginTurn(input()), /强制规则不可用/);
  w.close();
});
test('提炼失败最多三次且不推进来源游标', async () => {
  const { w, turn, advance } = setup();
  const t = turn();
  const worker = new MemoryWorker(w, async () => {
    throw new Error('模拟失败');
  });
  await worker.tick();
  advance(30000);
  await worker.tick();
  advance(30000);
  await worker.tick();
  advance(60000);
  await worker.tick();
  assert.equal(w.all<Job>('job')[0].state, 'failed');
  assert.equal(w.all<Job>('job')[0].retries, 3);
  assert.equal(w.activity(t.sessionKey).cursor, 0);
  w.close();
});
test('规则候选不能伪装成普通事实绕过审批', () => {
  const { w, turn, advance } = setup();
  const t = turn('a', '确认规则：交付审核=由经理审核');
  const [j] = w.planJobs();
  advance(30000);
  w.claimJob(j.id);
  assert.throws(
    () => w.commitJob(j.id, [{ key: '交付审核', value: '由经理审核', kind: 'fact', sourceIds: [t.id] }]),
    /类型/,
  );
  w.close();
});
