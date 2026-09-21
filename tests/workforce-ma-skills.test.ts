import test from 'node:test';
import assert from 'node:assert/strict';
import { MaSkills, migrateLocalSkills } from '../src/workforce/ma-skills.ts';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { initializeAda } from '../src/workforce/employee-templates.ts';
import { PLATFORM_SKILLS } from '../src/workforce/skill-catalog.ts';

const skill = {
  id: PLATFORM_SKILLS[0].id,
  name: 'ada-test',
  source: 'custom',
  latest_version: '2',
  description: '[ada] 真实技能',
  metadata: { tags: 'ada' },
};
test('仅按本地清单读取技能详情，不请求 MA 全量列表', async () => {
  const requested: string[] = [];
  const client = new MaSkills({ apiKey: () => 'secret-key' }, async (url, options) => {
    requested.push(String(url));
    const id = String(url).split('/').pop();
    assert.ok(PLATFORM_SKILLS.some((entry) => entry.id === id));
    assert.equal((options?.headers as any).Authorization, 'Bearer secret-key');
    assert.equal(options?.redirect, 'error');
    return Response.json({ ...skill, id, description: '真实技能，无描述标签' });
  });
  const result = await client.list();
  assert.equal(requested.length, 3);
  assert.deepEqual(
    result.skills.map((s) => s.id),
    PLATFORM_SKILLS.map((s) => s.id),
  );
  assert.equal(result.skills[0].version, '2');
  assert.deepEqual(result.skills[0].tags, ['ada']);
  assert.equal(result.hasMore, false);
  assert.ok(!JSON.stringify(result).includes('secret-key'));
});
test('拒绝关联本地清单外的技能且不请求 MA', async () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const ada = initializeAda(workspace);
    const client = new MaSkills({ apiKey: () => 'key' }, async () => {
      assert.fail('不应请求清单外技能');
    });
    await assert.rejects(client.bind(workspace, ada.employeeId, 'skill-other'), /本地技能清单/);
    assert.equal(workspace.read().state.employees[0].skills.length, 0);
  } finally {
    workspace.close();
  }
});
test('绑定从 MA 详情读取标准字段，重复操作不新增，生成真实 Agent 引用', async () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const ada = initializeAda(workspace);
    const client = new MaSkills({ apiKey: () => 'key' }, async () => Response.json(skill));
    await client.bind(workspace, ada.employeeId, skill.id);
    const result = await client.bind(workspace, ada.employeeId, skill.id);
    assert.equal(result.state.employees[0].skills.length, 1);
    assert.deepEqual(await client.references(result.state.employees[0].skills), [
      { type: 'custom', skill_id: skill.id, version: '2' },
    ]);
    await assert.rejects(client.references([{ enabled: true, id: 'mock' }]), /模拟技能/);
    await assert.rejects(
      client.references([{ ...result.state.employees[0].skills[0], version: '1' }]),
      /已更新/,
    );
  } finally {
    workspace.close();
  }
});
test('鉴权、远端错误和结构错误明确报错，不返回模拟空列表或远端敏感内容', async () => {
  await assert.rejects(new MaSkills({ apiKey: () => undefined }).list(), /APIKey/);
  for (const response of [
    new Response('secret-key', { status: 403 }),
    Response.json({ unexpected: true }),
    Response.json({ data: [], has_more: true }),
  ]) {
    const client = new MaSkills({ apiKey: () => 'secret-key' }, async () => response);
    await assert.rejects(client.list(), (error: Error) => !error.message.includes('secret-key'));
  }
});
test('迁移模拟技能到知识，不覆盖已绑定技能且可重复执行', () => {
  const workspace = new LocalWorkspace(':memory:');
  try {
    const initial = initializeAda(workspace);
    initial.state.employees[0].skills = [
      { id: 'legacy', name: '旧流程', instructions: '保留内容', enabled: true },
      { id: 'real', source: 'ma', name: '真实技能', enabled: true },
    ];
    workspace.save(initial.state, initial.revision);
    migrateLocalSkills(workspace);
    const migrated = workspace.read();
    assert.match(migrated.state.employees[0].knowledge, /保留内容/);
    assert.equal(migrated.state.employees[0].skills[0].id, 'real');
    migrateLocalSkills(workspace);
    assert.equal(workspace.read().revision, migrated.revision);
  } finally {
    workspace.close();
  }
});
