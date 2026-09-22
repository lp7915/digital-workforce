import test from 'node:test';
import assert from 'node:assert/strict';
import { createLarkChannel } from '@larksuite/channel';
import { initializeAda } from '../src/workforce/employee-templates.ts';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { syncBotGroup, syncMessageGroup } from '../src/workforce/group-events.ts';
import { registerGroupEvents } from '../src/workforce/group-event-adapter.ts';
import { memoryScope } from '../src/workforce/session-memory.ts';

test('群事件重复和乱序不会恢复已退群员工，项目关系保留', () => {
  const w = new LocalWorkspace(':memory:');
  try {
    const ada = initializeAda(w);
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_demo', joined: true, time: 10 });
    const current = w.read();
    current.state.projects.push({
      id: 'p',
      name: '项目',
      memoryStores: [],
      memories: [],
      members: [{ id: 'm', name: '管理员', account: 'local-admin', permission: 'manage' }],
      groups: [],
    });
    current.state.groups[0].projectId = 'p';
    w.save(current.state, current.revision);
    assert.equal(w.read().state.projects[0].employees[0].id, ada.employeeId);
    const restricted = w.read();
    restricted.state.projects[0].employees = [];
    w.save(restricted.state, restricted.revision);
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_demo', joined: true, time: 15 });
    assert.deepEqual(w.read().state.projects[0].employees, []);
    assert.deepEqual(w.read().state.groups[0].employeeIds, [ada.employeeId]);
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_demo', joined: false, time: 20 });
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_demo', joined: true, time: 10 });
    assert.deepEqual(w.read().state.groups[0].employeeIds, []);
    assert.equal(w.read().state.groups[0].projectId, 'p');
  } finally {
    w.close();
  }
});
test('参与其他项目不影响当前群的记忆范围，私聊仍只加载自身', () => {
  const w = new LocalWorkspace(':memory:');
  try {
    const ada = initializeAda(w);
    const state = w.read().state;
    const employee = state.employees[0];
    employee.memoryMode = 'ma';
    employee.memoryStores = [{ maStoreId: 'memstore-self' }];
    state.projects = [
      {
        id: 'p',
        employees: [{ id: ada.employeeId }],
        memoryMode: 'ma',
        memoryStores: [{ maStoreId: 'memstore-project' }],
      },
      {
        id: 'other',
        employees: [{ id: ada.employeeId }],
        memoryMode: 'ma',
        memoryStores: [{ maStoreId: 'memstore-other' }],
      },
    ];
    state.groups = [{ chatId: 'oc_demo', projectId: 'p', employeeIds: [ada.employeeId] }];
    assert.deepEqual(
      memoryScope(state, ada.employeeId, { conversationId: 'oc_demo', conversationType: 'group' }).storeIds,
      ['memstore-project', 'memstore-self'],
    );
    state.projects[0].employees = [];
    assert.deepEqual(
      memoryScope(state, ada.employeeId, { conversationId: 'oc_demo', conversationType: 'group' }).storeIds,
      ['memstore-project', 'memstore-self'],
    );
    assert.deepEqual(
      memoryScope(state, ada.employeeId, { conversationId: 'dm', conversationType: 'direct' }).storeIds,
      ['memstore-self'],
    );
  } finally {
    w.close();
  }
});
test('当前 Channel SDK 支持共用 dispatcher 注册进退群事件', async () => {
  const channel = createLarkChannel({ appId: 'test', appSecret: 'test', includeRawEvent: true });
  const seen: any[] = [];
  registerGroupEvents(channel, 'test', (e) => seen.push(e));
  const dispatcher = (channel as any).dispatcher;
  // 模拟 connect 中默认处理器的再次注册，覆盖实际启动生命周期。
  (channel as any).registerDispatcherHandlers();
  await dispatcher.invoke({
    schema: '2.0',
    header: { event_id: 'joined', event_type: 'im.chat.member.bot.added_v1', create_time: '100' },
    event: { chat_id: 'oc_demo', app_id: 'test', operator_id: { open_id: 'ou_user' } },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].joined, true);
  await dispatcher.invoke({
    schema: '2.0',
    header: { event_id: '1', event_type: 'im.chat.member.bot.deleted_v1', create_time: '200' },
    event: { chat_id: 'oc_demo', app_id: 'test' },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].joined, false);
});

test('群消息补齐遗漏入群关系，旧消息不覆盖退群记录', () => {
  const w = new LocalWorkspace(':memory:');
  try {
    const ada = initializeAda(w);
    const message = { conversationType: 'group' as const, conversationId: 'oc_missing', createTime: 100 };
    syncMessageGroup(w, ada.employeeId, message);
    assert.deepEqual(w.read().state.groups[0].employeeIds, [ada.employeeId]);
    const revision = w.read().revision;
    syncMessageGroup(w, ada.employeeId, message);
    assert.equal(w.read().revision, revision);
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_missing', joined: false, time: 200 });
    syncMessageGroup(w, ada.employeeId, message);
    assert.deepEqual(w.read().state.groups[0].employeeIds, []);
    syncMessageGroup(w, ada.employeeId, { ...message, conversationType: 'direct', conversationId: 'dm' });
    assert.equal(w.read().state.groups.length, 1);
  } finally {
    w.close();
  }
});

test('明确退群后消息不恢复成员，其他机器人及项目保留，新进群事件可以恢复', () => {
  const w = new LocalWorkspace(':memory:');
  try {
    const ada = initializeAda(w);
    const initial = w.read();
    initial.state.employees.push({ ...structuredClone(initial.state.employees[0]), id: 'other' });
    w.save(initial.state, initial.revision);
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_removed', joined: true, time: 100 });
    syncBotGroup(w, 'other', { chatId: 'oc_removed', joined: true, time: 110 });
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_removed', joined: false, time: 200 });
    syncMessageGroup(w, ada.employeeId, {
      conversationType: 'group',
      conversationId: 'oc_removed',
      createTime: 300,
    });
    assert.deepEqual(w.read().state.groups[0].employeeIds, ['other']);
    assert.throws(
      () =>
        memoryScope(w.read().state, ada.employeeId, {
          conversationType: 'group',
          conversationId: 'oc_removed',
        }),
      /群聊未关联/,
    );
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_removed', joined: true, time: 400 });
    assert.ok(w.read().state.groups[0].employeeIds.includes(ada.employeeId));
    syncBotGroup(w, ada.employeeId, { chatId: 'oc_unknown', joined: false, time: 500 });
    syncMessageGroup(w, ada.employeeId, {
      conversationType: 'group',
      conversationId: 'oc_unknown',
      createTime: 600,
    });
    assert.deepEqual(w.read().state.groups.find((g) => g.chatId === 'oc_unknown').employeeIds, []);
  } finally {
    w.close();
  }
});

test('退群事件的微秒时间转换为毫秒', async () => {
  const channel = createLarkChannel({ appId: 'test', appSecret: 'test' });
  const seen: any[] = [];
  registerGroupEvents(channel, 'test', (e) => seen.push(e));
  (channel as any).registerDispatcherHandlers();
  await (channel as any).dispatcher.invoke({
    schema: '2.0',
    header: {
      event_id: 'remove-time',
      event_type: 'im.chat.member.bot.deleted_v1',
      create_time: '1790000000123000',
    },
    event: { chat_id: 'oc_demo', app_id: 'test' },
  });
  assert.equal(seen[0].time, 1790000000123);
  assert.equal(seen[0].joined, false);
});
