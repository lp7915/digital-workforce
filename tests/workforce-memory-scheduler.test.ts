import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MemoryScheduler, midnightAfter } from '../src/workforce/memory-scheduler.ts';
function fixture() {
  let time = Date.parse('2026-09-22T15:59:59Z');
  const db = new DatabaseSync(':memory:'),
    tasks = new Map<string, any>(),
    calls: any[] = [];
  const state = {
    projects: [{ id: 'p', memoryStores: [{ id: 'a' }, { id: 'b' }] }],
    employees: [{ id: 'e', enabled: true }],
    groups: [{ projectId: 'p', chatId: 'c', employeeIds: ['e'] }],
  };
  const workspace: any = {
    db,
    read: () => ({ state }),
    tasks: () => [...tasks.values()],
    putTask: (t: any) => tasks.set(t.id, t),
  };
  const organizer: any = {
    start: (input: any) => {
      calls.push(input);
      const task = { ...input, id: input.requestId, type: 'memory', status: 'running' };
      tasks.set(task.id, task);
      return task;
    },
  };
  const sessions: any = { recent: () => [{ chatId: 'c' }] };
  const create = () => new MemoryScheduler(workspace, organizer, sessions, () => time);
  return {
    db,
    tasks,
    calls,
    state,
    organizer,
    sessions,
    create,
    setTime: (v: string) => {
      time = Date.parse(v);
    },
  };
}
test('按北京时间零点触发，所有库串行整理，同日与重启不会重复派发', () => {
  const f = fixture();
  try {
    const s = f.create();
    s.tick();
    assert.equal(f.calls.length, 0);
    f.setTime('2026-09-22T16:00:00Z');
    s.tick();
    assert.equal(f.calls.length, 1);
    s.tick();
    f.create().tick();
    assert.equal(f.calls.length, 1);
    f.tasks.get(f.calls[0].requestId).status = 'completed';
    s.tick();
    assert.equal(f.calls.length, 2);
    f.tasks.get(f.calls[1].requestId).status = 'completed';
    s.tick();
    s.tick();
    assert.equal(f.calls.length, 2);
    assert.equal(f.tasks.get('nightly-memory:2026-09-23').status, 'completed');
    f.setTime('2026-09-23T16:00:00Z');
    s.tick();
    assert.equal(f.calls.length, 3);
  } finally {
    f.db.close();
  }
});
test('离线后只补跑最近一次到期任务，不突发补跑每个历史日期', () => {
  const f = fixture();
  try {
    f.create();
    f.setTime('2026-09-25T01:00:00Z');
    f.create().tick();
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].requestId, /2026-09-25/);
  } finally {
    f.db.close();
  }
});
test('无来源跳过，禁用员工跳过，记录空批次', () => {
  const f = fixture();
  try {
    const s = f.create();
    f.state.employees[0].enabled = false;
    f.setTime('2026-09-22T16:00:00Z');
    s.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.tasks.get('nightly-memory:2026-09-23').status, 'completed');
  } finally {
    f.db.close();
  }
});
test('启动失败记录结果并继续其他库，手动整理期间等待', () => {
  const f = fixture();
  try {
    const s = f.create();
    f.tasks.set('manual', { id: 'manual', type: 'memory', status: 'running' });
    f.setTime('2026-09-22T16:00:00Z');
    s.tick();
    assert.equal(f.calls.length, 0);
    f.tasks.get('manual').status = 'completed';
    f.organizer.start = () => {
      throw Error('secret');
    };
    s.tick();
    s.tick();
    s.tick();
    const task = f.tasks.get('nightly-memory:2026-09-23');
    assert.equal(task.status, 'failed');
    assert.equal(JSON.stringify(task).includes('secret'), false);
  } finally {
    f.db.close();
  }
});
test('下一次零点与主机时区无关', () => {
  assert.equal(
    new Date(midnightAfter(Date.parse('2026-09-22T02:00:00Z'))).toISOString(),
    '2026-09-22T16:00:00.000Z',
  );
});

test('没有已完成来源的员工不创建整理任务', () => {
  const f = fixture();
  try {
    const s = f.create();
    f.sessions.recent = () => [];
    f.setTime('2026-09-22T16:00:00Z');
    s.tick();
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});
