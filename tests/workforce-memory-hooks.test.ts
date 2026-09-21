import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway, type IncomingMessage } from '../src/gateway.ts';
import { GatewayStore } from '../src/store.ts';

const message = (text: string): IncomingMessage => ({
  channelType: 'lark',
  installationId: 'bot',
  tenantId: 'tenant',
  eventId: 'event',
  messageId: 'message',
  conversationId: 'chat',
  conversationType: 'group',
  threadId: '',
  rootMessageId: '',
  parentMessageId: '',
  createTime: Date.now(),
  senderId: 'ou_writer',
  text,
  resources: [],
  mentionedBot: true,
});
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(10);
  }
  throw new Error('等待 Gateway 回复超时');
}
test('群整理命令交给业务服务，回复提交状态且不调用普通对话 Agent', async () => {
  const store = new GatewayStore(':memory:');
  const replies: string[] = [];
  let calls = 0;
  const gateway = new Gateway(
    store,
    {
      createSession: async () => {
        calls++;
        return 'sesn-test';
      },
      run: async () => {
        calls++;
        return { terminal: 'idle', messages: ['普通回复'] };
      },
    },
    async (_m, reply) => {
      if (reply.type === 'text') replies.push(reply.text);
    },
    {
      agentId: 'agent',
      environmentId: 'env',
      vaultId: 'vlt',
      timeoutMs: 1000,
      platformAccess: true,
      handleBusinessCommand: async (m) => (m.text === '/remember' ? '已提交项目记忆整理任务' : undefined),
    },
  );
  try {
    gateway.accept(message('/remember'));
    await waitFor(() => replies.length > 0);
    assert.match(replies[0], /已提交/);
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});
test('挂载作用域校验失败时，Gateway 不向 MA 投递本轮任务', async () => {
  const store = new GatewayStore(':memory:');
  const replies: string[] = [];
  let runs = 0;
  const gateway = new Gateway(
    store,
    {
      createSession: async () => 'sesn-test',
      run: async () => {
        runs++;
        return { terminal: 'idle', messages: ['不应执行'] };
      },
    },
    async (_m, reply) => {
      if (reply.type === 'text') replies.push(reply.text);
    },
    {
      agentId: 'agent',
      environmentId: 'env',
      vaultId: 'vlt',
      timeoutMs: 1000,
      platformAccess: true,
      validateBusinessSession: async () => {
        throw new Error('项目已变化，请发送 /new');
      },
    },
  );
  try {
    gateway.accept(message('查询项目背景'));
    await waitFor(() => replies.length > 0);
    assert.match(replies.join(''), /项目已变化/);
    assert.equal(runs, 0);
  } finally {
    store.close();
  }
});
