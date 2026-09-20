import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway, type IncomingMessage } from '../src/gateway.ts';
import { GatewayStore } from '../src/store.ts';
import { Workforce, type Turn, type Memory, MemoryWorker } from '../src/workforce/domain.ts';
import { WorkforceBridge } from '../src/workforce/bridge.ts';
const admin = { id: 'admin', role: 'admin' } as const;
const message = (id: string, text: string, chat = 'a', thread = ''): IncomingMessage => ({
  channelType: 'lark',
  installationId: 'test-bot',
  tenantId: 't',
  eventId: id,
  messageId: id,
  conversationId: chat,
  conversationType: 'group',
  threadId: thread,
  rootMessageId: '',
  parentMessageId: '',
  createTime: Date.now(),
  senderId: id,
  text,
  resources: [],
  mentionedBot: true,
});
async function waitFor(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await delay(10);
  }
  throw new Error('测试等待超时');
}
test('真实Gateway每群共享排队、话题并行、每轮注入权限快照，/new不删记忆', async () => {
  let now = 1000;
  const w = new Workforce(':memory:', () => now);
  const store = new GatewayStore(':memory:');
  const e = w.createEmployee(admin, { name: '员工' });
  w.publish(admin, e.id, 1);
  const p = w.createProject(admin, { name: '项目' });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'a', sharedWith: [] });
  const bridge = new WorkforceBridge(w, e.id);
  let count = 0;
  const inputs: string[] = [];
  let unblock: () => void;
  const replies: string[] = [];
  const sessions: string[] = [];
  const gateway = new Gateway(
    store,
    {
      createSession: async () => `s-${++count}`,
      run: async (sessionId, input) => {
        inputs.push(input);
        sessions.push(sessionId);
        if (input.includes('阻塞任务'))
          await new Promise<void>((resolve) => {
            unblock = resolve;
          });
        return { terminal: 'idle', messages: ['已处理'] };
      },
    },
    async (_m, r) => {
      if (r.type === 'text') replies.push(r.text);
    },
    {
      agentId: 'agent',
      environmentId: 'env',
      vaultId: 'vault',
      timeoutMs: 5000,
      platformAccess: true,
      sharedGroupSessions: true,
      ...bridge.hooks(),
    },
  );
  const accept = (m: IncomingMessage) => {
    if (gateway.accept(m)) bridge.queued(m);
  };
  accept(message('1', '阻塞任务'));
  accept(message('2', '确认事实：负责人=李工'));
  accept(message('3', '独立话题', 'a', 'topic'));
  await waitFor(() => inputs.length === 2);
  assert.equal(count, 2);
  unblock!();
  await waitFor(() => replies.length === 3);
  assert.equal(sessions[0], sessions[2]);
  assert.match(inputs[2], /gateway_context/);
  const worker = new MemoryWorker(w);
  await worker.tick();
  now += 30000;
  await worker.tick();
  assert.equal(w.all<Memory>('memory').length, 1);
  accept(message('4', '谁负责'));
  await waitFor(() => replies.length === 4);
  assert.match(inputs.at(-1)!, /李工/);
  accept(message('5', '/new'));
  await waitFor(() => replies.length === 5);
  assert.equal(w.all('memory').length, 1);
  accept(message('6', '谁负责'));
  await waitFor(() => replies.length === 6);
  assert.equal(count, 3);
  assert.match(inputs.at(-1)!, /李工/);
  assert.equal(w.all<Turn>('turn').filter((t) => t.state === 'idle').length, 5);
  store.close();
  w.close();
});
test('撤权后旧MA上下文不能继续执行，必须显式开启新Session', async () => {
  const w = new Workforce(':memory:');
  const e = w.createEmployee(admin, { name: '员工' });
  w.publish(admin, e.id, 1);
  const p = w.createProject(admin, { name: '项目' });
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'a' });
  const bridge = new WorkforceBridge(w, e.id);
  const hooks = bridge.hooks();
  const m = message('1', '问题');
  await hooks.beforeBusinessTurn!(m);
  await hooks.prepareBusinessInput!(m, 'session', '任务');
  await hooks.observeBusinessResult!(m, 'session', { terminal: 'idle', messages: ['ok'] });
  await hooks.afterBusinessTurn!(m, false);
  w.bind(admin, { employeeId: e.id, projectId: p.id, chatId: 'a', sharedWith: ['b'] });
  const next = message('2', '问题');
  await hooks.beforeBusinessTurn!(next);
  await assert.rejects(hooks.prepareBusinessInput!(next, 'session', '任务'), /待升级/);
  await hooks.afterBusinessTurn!(next, true);
  w.close();
});
