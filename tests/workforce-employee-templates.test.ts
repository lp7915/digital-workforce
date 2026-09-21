import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { Workforce } from '../src/workforce/domain.ts';
import { createWeb } from '../src/workforce/web.ts';
import { createAdaEmployee, initializeAda } from '../src/workforce/employee-templates.ts';

test('初始化保存 ADA 全部配置和有效的记忆库路径，不创建渠道或凭证', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const result = initializeAda(workspace);
    const employee = workspace.read().state.employees[0];
    assert.equal(employee.name, 'ADA');
    assert.equal(result.created, true);
    assert.equal(employee.skills.length, 0);
    assert.equal(employee.memories.length, 5);
    assert.ok(employee.memories.every((entry: any) => entry.storeId === employee.memoryStores[0].id));
    assert.deepEqual(employee.credentials, []);
    assert.equal(employee.channels.feishu.enabled, false);
  } finally {
    workspace.close();
  }
});
test('重复初始化返回原员工，保留用户修改与修订号', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const first = initializeAda(workspace);
    first.state.employees[0].identity = '用户修改的身份';
    workspace.save(first.state, first.revision);
    const revision = workspace.read().revision;
    const again = initializeAda(workspace);
    assert.equal(again.employeeId, first.employeeId);
    assert.equal(again.created, false);
    assert.equal(again.revision, revision);
    assert.equal(again.state.employees[0].identity, '用户修改的身份');
    assert.equal(again.state.employees.length, 1);
  } finally {
    workspace.close();
  }
});
test('同名普通员工不被覆盖或产生重复', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const employee: any = createAdaEmployee();
    delete employee.templateId;
    workspace.save({ employees: [employee], projects: [], groups: [] }, 0);
    assert.throws(() => initializeAda(workspace), /不会覆盖/);
    assert.equal(workspace.read().state.employees.length, 1);
  } finally {
    workspace.close();
  }
});
test('分析流程保留在知识中，不生成模拟技能', () => {
  const employee = createAdaEmployee();
  assert.match(employee.knowledge, /数据清洗与口径核验/);
  assert.deepEqual(employee.skills, []);
});
test('初始化接口可用且拒绝跨站写入', async () => {
  const workspace = new LocalWorkspace(':memory:');
  const workforce = new Workforce(':memory:');
  const { server, url } = await createWeb(workforce, { port: 0, workspace });
  try {
    const endpoint = `${url}/api/workspace/employee-templates/ada/initialize`;
    const rejected = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: '{}',
    });
    assert.equal(rejected.status, 403);
    assert.equal(workspace.read().state.employees.length, 0);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state.employees[0].name, 'ADA');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    workforce.close();
    workspace.close();
  }
});
