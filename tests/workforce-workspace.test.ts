import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { Workforce } from '../src/workforce/domain.ts';
import { createWeb } from '../src/workforce/web.ts';

function state() {
  return {
    employees: [
      {
        id: 'e',
        name: '策划',
        enabled: true,
        identity: '品牌顾问',
        knowledge: '品牌知识',
        rules: '保留来源',
        skills: [],
        credentials: [],
        environment: { name: '本机', model: '待接入', region: '北京', timeout: 300 },
        channels: { feishu: { enabled: false, appId: '' }, doubao: { enabled: false, agentId: '' } },
        versions: [],
        activeVersion: null,
        memoryStores: [{ id: 'em', name: '经验库' }],
        memories: [{ id: 'em1', storeId: 'em', path: 'notes/preference.md', content: '先结论后依据' }],
      },
    ],
    projects: [
      {
        id: 'p',
        name: '上市',
        memoryStores: [{ id: 'pm', name: '项目库' }],
        memories: [{ id: 'pm1', storeId: 'pm', path: 'brief.md', content: '以用户场景为核心' }],
        groups: [{ id: 'g', name: '项目群', chatId: 'oc_test', employeeId: 'e' }],
        members: [{ id: 'm', name: '负责人', account: 'local', permission: 'manage' }],
      },
    ],
  };
}
test('工作台以修订号拒绝覆盖，重启后保留记忆路径与内容', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workforce-workspace-'));
  let workspace = new LocalWorkspace(join(dir, 'workspace.db'));
  try {
    const saved = workspace.save(state(), 0);
    assert.equal(saved.revision, 1);
    assert.throws(() => workspace.save(state(), 0), /其他页面/);
    workspace.close();
    workspace = new LocalWorkspace(join(dir, 'workspace.db'));
    assert.equal(workspace.read().state.projects[0].memories[0].path, 'brief.md');
  } finally {
    workspace.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('后端拒绝重复路径、非法目录、缺失管理员和无效员工关联', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    for (const invalid of ['../brief.md', '/brief.md', 'notes//brief.md']) {
      const input = state();
      input.projects[0].memories[0].path = invalid;
      assert.throws(() => workspace.save(input, 0), /路径/);
    }
    const duplicate = state();
    duplicate.projects[0].memories.push({ ...duplicate.projects[0].memories[0], id: 'other' });
    assert.throws(() => workspace.save(duplicate, 0), /路径/);
    const missing = state();
    missing.projects[0].members = [];
    assert.throws(() => workspace.save(missing, 0), /管理成员/);
    const foreign = state();
    foreign.projects[0].groups[0].employeeId = 'missing';
    assert.throws(() => workspace.save(foreign, 0), /员工/);
  } finally {
    workspace.close();
  }
});
test('任务固定配置与记忆快照，实际执行后生成可追溯文本，客户端不能覆盖任务', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    workspace.save(state(), 0);
    const task = workspace.enqueue({
      name: '本地验收',
      employeeId: 'e',
      projectId: 'p',
      requestId: 'request-1',
    });
    assert.equal(
      workspace.enqueue({ name: '本地验收', employeeId: 'e', projectId: 'p', requestId: 'request-1' }).id,
      task.id,
    );
    const next = state();
    next.projects[0].memories[0].content = '后续修改';
    workspace.save({ ...next, tasks: [] }, 1);
    workspace.tick();
    assert.equal(workspace.tasks()[0].status, 'running');
    workspace.tick();
    const completed = workspace.tasks()[0];
    assert.equal(completed.status, 'completed');
    assert.match(completed.result, /以用户场景为核心/);
    assert.doesNotMatch(completed.result, /后续修改/);
    assert.match(completed.result, /brief.md/);
  } finally {
    workspace.close();
  }
});
test('取消任务不会执行，禁用员工不能发起任务', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    workspace.save(state(), 0);
    const task = workspace.enqueue({
      employeeId: 'e',
      projectId: 'p',
      name: '取消验收',
      requestId: 'cancel-1',
    });
    workspace.cancel(task.id);
    workspace.tick();
    assert.equal(workspace.tasks()[0].status, 'cancelled');
    const next = state();
    next.employees[0].enabled = false;
    workspace.save(next, 1);
    assert.throws(
      () => workspace.enqueue({ employeeId: 'e', projectId: 'p', name: '禁用', requestId: 'disabled-1' }),
      /停用/,
    );
  } finally {
    workspace.close();
  }
});

test('工作台 HTTP 保存、读取和任务执行贯通，跨站和非法写入被拒绝', async () => {
  const workspace = new LocalWorkspace(':memory:');
  const old = new Workforce(':memory:');
  const { server, url } = await createWeb(old, { port: 0, workspace });
  const call = (path: string, method = 'GET', payload?: unknown, origin?: string) =>
    fetch(url + '/api/workspace' + path, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  try {
    assert.equal((await (await call('')).json()).initialized, false);
    assert.equal((await call('', 'PUT', { state: state(), revision: 0 }, 'https://evil.test')).status, 403);
    assert.equal((await call('', 'PUT', { state: state(), revision: 0 })).status, 403);
    workspace.save(state(), 0);
    assert.equal((await call('', 'PUT', { state: state(), revision: 0 })).status, 409);
    assert.equal((await call('', 'PUT', { state: {}, revision: 1 })).status, 400);
    const response = await call('/tasks', 'POST', {
      name: 'HTTP 验收',
      employeeId: 'e',
      projectId: 'p',
      requestId: 'http-test',
    });
    assert.equal(response.status, 201);
    workspace.tick();
    workspace.tick();
    const result = await (await call('/tasks')).json();
    assert.match(result.tasks[0].result, /先结论后依据/);
    assert.equal((await (await call('')).json()).state.projects[0].members[0].permission, 'manage');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    workspace.close();
    old.close();
  }
});

test('进程重启恢复未完成任务，已完成任务不会重复运行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workforce-recovery-'));
  let workspace = new LocalWorkspace(join(dir, 'workspace.db'));
  try {
    workspace.save(state(), 0);
    workspace.enqueue({ name: '恢复验收', employeeId: 'e', projectId: 'p', requestId: 'recovery' });
    workspace.tick();
    workspace.close();
    workspace = new LocalWorkspace(join(dir, 'workspace.db'));
    assert.equal(workspace.tasks()[0].status, 'queued');
    workspace.tick();
    workspace.tick();
    const result = workspace.tasks()[0].finishedAt;
    workspace.tick();
    assert.equal(workspace.tasks()[0].finishedAt, result);
  } finally {
    workspace.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('后端拒绝畸形配置、明文凭证与已发布版本篡改', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const input = state();
    const employee: any = input.employees[0];
    employee.environment.timeout = -1;
    assert.throws(() => workspace.save(input, 0), /运行超时/);
    employee.environment.timeout = 300;
    employee.credentials.push({ id: 'c', name: '错误凭证', reference: 'raw-secret' });
    assert.throws(() => workspace.save(input, 0), /凭证引用/);
    employee.credentials = [];
    const { memories, memoryStores, versions, activeVersion, ...snapshot } = employee;
    employee.versions = [{ id: 'v1', number: 1, snapshot: structuredClone(snapshot) }];
    employee.activeVersion = 'v1';
    workspace.save(input, 0);
    employee.versions[0].snapshot.identity = '被篡改';
    assert.throws(() => workspace.save(input, 1), /不可修改/);
  } finally {
    workspace.close();
  }
});

test('群聊从项目迁移，可独立登记并关联多位员工，项目视图保持一致', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    workspace.save(state(), 0);
    const data = workspace.read().state;
    assert.equal(data.groups[0].projectId, 'p');
    assert.deepEqual(data.groups[0].employeeIds, ['e']);
    data.employees.push({ ...structuredClone(data.employees[0]), id: 'e2', name: '创意' });
    data.groups.push({
      id: 'independent',
      name: '独立群',
      chatId: 'oc_independent',
      projectId: '',
      employeeIds: [],
    });
    data.groups[0].employeeIds.push('e2');
    data.projects[0].employees.push({ id: 'e2', role: '内容创意', permission: 'read' });
    workspace.save(data, 1);
    assert.equal(workspace.read().state.groups.length, 2);
    assert.deepEqual(workspace.read().state.projects[0].groups[0].employeeIds, ['e', 'e2']);
    data.groups[0].projectId = '';
    workspace.save(data, 2);
    assert.equal(workspace.read().state.projects[0].groups.length, 0);
    assert.equal(workspace.read().state.groups.length, 2);
    data.groups[1].chatId = 'oc_test';
    assert.throws(() => workspace.save(data, 3), /已登记/);
    data.groups[1].chatId = 'oc_independent';
    data.groups[1].employeeIds = ['missing'];
    assert.throws(() => workspace.save(data, 3), /员工/);
  } finally {
    workspace.close();
  }
});
