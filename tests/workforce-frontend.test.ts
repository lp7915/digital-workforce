import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function fixture(storage = new Map<string, string>()) {
  return runInNewContext(
    source.slice(0, source.indexOf('let data =')) + '\n({ seed, snapshot, repository });',
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
