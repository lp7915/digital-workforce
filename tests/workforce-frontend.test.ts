import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function fixture(storage = new Map<string, string>()) {
  return runInNewContext(
    source.slice(0, source.indexOf('let data =')) +
      '\n({ seed, snapshot, repository, migrateMemories, memoryError });',
    {
      structuredClone,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  );
}

test('前端发布快照独立于后续配置和员工记忆', () => {
  const { seed, snapshot } = fixture();
  const employee = seed().employees[0];
  const version = snapshot(employee);
  employee.skills[0].name = '后续调整';
  assert.equal(version.skills[0].name, 'Brief 分析');
  assert.equal('memories' in version, false);
  assert.equal('versions' in version, false);
});

test('旧记忆迁移到默认库后保留内容且重复迁移稳定', () => {
  const { seed, migrateMemories } = fixture();
  const data = seed();
  const content = data.projects[0].memories[0].content;
  migrateMemories(data);
  const once = JSON.stringify(data);
  migrateMemories(data);
  assert.equal(JSON.stringify(data), once);
  assert.equal(data.projects[0].memories[0].content, content);
  assert.equal(data.projects[0].memories[0].path, 'notes/pm1.md');
});

test('同库重复路径被拒绝，不同库允许同名路径，编辑自身允许保留路径', () => {
  const { repository, memoryError } = fixture();
  const owner = repository.load().employees[0];
  const entry = owner.memories[0];
  assert.match(memoryError(owner, entry), /已存在/);
  assert.equal(memoryError(owner, entry, entry.id), '');
  owner.memoryStores.push({ id: 'other', name: '其他库' });
  assert.equal(memoryError(owner, { ...entry, storeId: 'other' }), '');
  assert.match(memoryError(owner, { ...entry, path: '../notes.md' }), /有效/);
});

test('库与条目刷新后保留且不进入员工配置版本', () => {
  const { repository, snapshot } = fixture();
  const data = repository.load();
  const owner = data.employees[0];
  owner.memoryStores.push({ id: 'work', name: '工作经验' });
  Object.assign(owner.memories[0], { storeId: 'work', path: 'notes/偏好.md', content: '  原始文本\n' });
  repository.save(data);
  assert.equal(repository.load().employees[0].memories[0].content, '  原始文本\n');
  assert.equal(repository.load().employees[0].memories[0].storeId, 'work');
  assert.equal('memoryStores' in snapshot(owner), false);
});

test('浏览器刷新后保留员工配置和项目成员权限', () => {
  const { repository } = fixture();
  const data = repository.load();
  data.projects[0].members[1].permission = 'read';
  data.employees[0].identity = '新的职责';
  assert.equal(repository.save(data), true);
  const restored = repository.load();
  assert.equal(restored.projects[0].members[1].permission, 'read');
  assert.equal(restored.employees[0].identity, '新的职责');
});

test('损坏的本地演示数据不会导致首次页面无法初始化', () => {
  const { repository } = fixture(new Map([['workforce.frontend.v1', 'not-json']]));
  assert.equal(repository.load().employees.length, 2);
});
