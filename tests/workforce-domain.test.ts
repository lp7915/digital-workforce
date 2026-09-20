import test from 'node:test';
import assert from 'node:assert/strict';
import { Workforce } from '../src/workforce/domain.ts';
const admin = { id: 'admin', role: 'admin' } as const;
const viewer = { id: 'reader', role: 'viewer' } as const;
export function fixture() {
  const w = new Workforce(':memory:');
  const e = w.createEmployee(admin, { name: '策略顾问' });
  const release = w.publish(admin, e.id, 1);
  const p = w.createProject(admin, { name: '品牌上市', managers: ['pm'] });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'a', sharedWith: ['b'] });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'b', sharedWith: ['a'] });
  return { w, e, p, release };
}
test('只有管理员能发布，草稿并发校验且发布快照不可变', () => {
  const { w, e, release } = fixture();
  assert.throws(() => w.saveDraft(viewer, e.id, { ...e.draft, identity: '越权' }, 1), /权限/);
  w.saveDraft(admin, e.id, { ...e.draft, identity: '新版身份' }, 1);
  assert.equal(w.release(release.id).content.identity, e.draft.identity);
  assert.throws(() => w.saveDraft(admin, e.id, e.draft, 1), /版本/);
  const next = w.publish(admin, e.id, 2);
  w.activate(admin, e.id, release.id);
  assert.equal(w.employee(e.id).releaseId, release.id);
  assert.notEqual(next.id, release.id);
  w.close();
});
test('项目管理员只能管理自己的项目，普通业务身份只读', () => {
  const { w, e, p } = fixture();
  const pm = { id: 'pm', role: 'project_admin' } as const;
  w.bind(pm, { employeeId: e.id, projectId: p.id, chatId: 'c', sharedWith: [] });
  const other = w.createProject(admin, { name: '其他项目' });
  assert.throws(() => w.bind(pm, { employeeId: e.id, projectId: other.id, chatId: 'c', sharedWith: [] }), /权限/);
  assert.throws(() => w.publish(pm, e.id, 1), /权限/);
  assert.throws(() => w.bind(viewer, { employeeId: e.id, projectId: p.id, chatId: 'x' }), /权限/);
  w.close();
});
test('话题继承群项目，每轮快照固定，私聊不读取项目记忆', () => {
  const { w, e, p, release } = fixture();
  const s = w.beginTurn({ employeeId: e.id, chatId: 'a', threadId: 't', userId: 'u', messageId: 'm', text: '你好', direct: false });
  assert.equal(s.projectId, p.id);
  w.saveDraft(admin, e.id, { ...e.draft, rules: '新规则' }, 1);
  w.publish(admin, e.id, 2);
  assert.equal(s.releaseId, release.id);
  assert.equal(w.beginTurn({ employeeId: e.id, chatId: 'dm', userId: 'u', messageId: 'd', text: '我的日历', direct: true }).projectId, undefined);
  w.close();
});
