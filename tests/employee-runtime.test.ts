import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { createEmployeeRuntime } from '../src/employee-runtime.ts';
import { GatewayStore } from '../src/store.ts';

const config = {
  feishuAppId: 'cli',
  feishuAppSecret: 'secret',
  arkAgentId: 'agent',
  arkEnvironmentId: 'env',
  arkVaultId: 'vault',
  sessionTimeoutMs: 1000,
};
const message = (id: string, senderId = 'user') => ({
  channelType: 'lark',
  installationId: 'cli',
  tenantId: 'tenant',
  conversationId: 'chat',
  conversationType: 'group' as const,
  senderId,
  messageId: id,
  eventId: id,
  text: '你好',
  createTime: 100,
  resources: [],
  mentionedBot: true,
  threadId: '',
  rootMessageId: '',
  parentMessageId: '',
});
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await flush();
  assert.ok(check());
}

test('共用运行时使用流式卡片与表情，读取历史及引用，同群用户共享 Session', async () => {
  const store = new GatewayStore(':memory:');
  const calls: string[] = [];
  let sessions = 0,
    finished = 0;
  const channel = {
    tag: 'bound',
    async reply() {
      calls.push('plain');
    },
    async download() {
      throw new Error('本测试没有附件');
    },
    async streamReply(_message: any, producer: any) {
      assert.equal(this.tag, 'bound');
      calls.push('stream');
      await producer(async () => {});
      finished++;
    },
    async addReaction() {
      calls.push('reaction-add');
      return 'reaction';
    },
    async removeReaction() {
      calls.push('reaction-remove');
    },
    async loadRecentHistory() {
      calls.push('history');
      return [];
    },
    async readMessage() {
      calls.push('quoted');
      return { status: 'unavailable' as const };
    },
  };
  const runtime = createEmployeeRuntime({
    store,
    config,
    channel,
    ensureBotToken: async () => {},
    ark: {
      createSession: async () => {
        sessions++;
        return 'session';
      },
      run: async () => ({ terminal: 'idle', messages: ['**你好**'] }),
    } as any,
  });
  try {
    runtime.gateway.accept({ ...message('one'), parentMessageId: 'quoted' });
    await until(() => finished === 1 && calls.filter((c) => c === 'reaction-remove').length === 1);
    runtime.gateway.accept(message('two', 'another-user'));
    await until(() => finished === 2 && calls.filter((c) => c === 'reaction-remove').length === 2);
    assert.equal(sessions, 1);
    assert.equal(calls.filter((c) => c === 'stream').length, 2);
    assert.equal(calls.includes('plain'), false);
    assert.ok(calls.includes('history'));
    assert.ok(calls.includes('quoted'));
  } finally {
    runtime.auth.close();
    store.close();
  }
});

test('共用运行时接入授权状态与取消命令，不把命令交给模型', async () => {
  const store = new GatewayStore(':memory:');
  const replies: string[] = [];
  const runtime = createEmployeeRuntime({
    store,
    config,
    ensureBotToken: async () => {},
    channel: {
      reply: async (_message, outbound) => {
        if (outbound.type === 'text') replies.push(outbound.text);
      },
      download: async () => {
        throw new Error('不下载');
      },
    },
    ark: {
      createSession: async () => {
        throw new Error('不能调用 MA');
      },
      run: async () => {
        throw new Error('不能调用 MA');
      },
    } as any,
  });
  try {
    runtime.gateway.accept({ ...message('status'), conversationType: 'direct', text: '/auth status' });
    await until(() => replies.length === 1);
    runtime.gateway.accept({ ...message('cancel'), conversationType: 'direct', text: '/auth cancel' });
    await until(() => replies.length === 2);
    assert.ok(replies.every((text) => text.length > 0));
  } finally {
    runtime.auth.close();
    store.close();
  }
});
