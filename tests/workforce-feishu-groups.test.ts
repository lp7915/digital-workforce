import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuGroups } from '../src/workforce/feishu-groups.ts';
import { LocalWorkspace } from '../src/workforce/workspace.ts';

function fixture() {
  const workspace = new LocalWorkspace(':memory:');
  workspace.save(
    {
      employees: [
        {
          id: 'e',
          name: '助手',
          enabled: true,
          identity: '',
          knowledge: '',
          rules: '',
          environment: { timeout: 300 },
          skills: [],
          credentials: [],
          memories: [],
          memoryStores: [],
          versions: [],
          activeVersion: null,
          channels: { feishu: { enabled: false, appId: '' }, doubao: { enabled: false, agentId: '' } },
        },
      ],
      projects: [],
      groups: [],
    },
    0,
  );
  const calls: string[][] = [];
  let role = 'owner';
  let response: any = {};
  const service = new FeishuGroups(
    workspace,
    { view: () => ({ status: 'connected', appId: 'cli_bound' }) } as any,
    async (args) => {
      calls.push(args);
      if (args[0] === 'auth')
        return { identities: { user: { verified: true, openId: 'ou_me', userName: '测试用户' } } };
      if (args[1] === '+chat-list')
        return {
          chats: [{ chat_id: 'oc_owner' }, { chat_id: 'oc_manager' }, { chat_id: 'oc_member' }],
          has_more: true,
          page_token: 'next',
        };
      if (args[1] === 'chats') {
        const id = args[args.indexOf('--chat-id') + 1];
        return {
          name: '测试群',
          chat_mode: 'group',
          chat_status: 'normal',
          owner_id: id === 'oc_owner' && role === 'owner' ? 'ou_me' : 'ou_other',
          user_manager_id_list: id === 'oc_manager' ? ['ou_me'] : [],
        };
      }
      if (response instanceof Error) throw response;
      return response;
    },
  );
  return {
    workspace,
    service,
    calls,
    role: (value: string) => {
      role = value;
    },
    response: (value: any) => {
      response = value;
    },
  };
}
test('分页保留群主和管理员，过滤普通成员', async () => {
  const f = fixture();
  try {
    const result = await f.service.list('cursor');
    assert.deepEqual(
      result.groups.map((g) => g.chatId),
      ['oc_owner', 'oc_manager'],
    );
    assert.equal(result.pageToken, 'next');
    assert.ok(f.calls.find((args) => args.includes('cursor')));
  } finally {
    f.workspace.close();
  }
});
test('真实入群使用服务端绑定 App ID，重复添加不重复关联', async () => {
  const f = fixture();
  try {
    await f.service.add('oc_owner', 'e');
    await f.service.add('oc_owner', 'e');
    assert.deepEqual(f.workspace.read().state.groups[0].employeeIds, ['e']);
    const call = f.calls.find((args) => args.includes('create'))!;
    assert.deepEqual(JSON.parse(call[call.indexOf('--data') + 1]), { id_list: ['cli_bound'] });
    assert.ok(call.includes('user'));
  } finally {
    f.workspace.close();
  }
});
test('管理员权限撤回后不执行邀请', async () => {
  const f = fixture();
  try {
    await f.service.import('oc_owner');
    f.role('member');
    await assert.rejects(f.service.add('oc_owner', 'e'), /管理权限/);
    assert.ok(!f.calls.some((args) => args.includes('create')));
  } finally {
    f.workspace.close();
  }
});
test('远端失败、待审批及无效机器人均不写入关联', async () => {
  const f = fixture();
  try {
    for (const response of [
      new Error('远端失败'),
      { pending_approval_id_list: ['cli_bound'] },
      { invalid_id_list: ['cli_bound'] },
    ]) {
      f.response(response);
      await assert.rejects(f.service.add('oc_owner', 'e'));
      assert.equal(f.workspace.read().state.groups.length, 0);
    }
  } finally {
    f.workspace.close();
  }
});
test('未绑定或未知员工不能发起入群', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.add('oc_owner', 'unknown'), /数字员工/);
    const service = new FeishuGroups(f.workspace, {
      view: () => ({ status: 'awaiting_confirmation' }),
    } as any);
    await assert.rejects(service.add('oc_owner', 'e'), /飞书连接/);
  } finally {
    f.workspace.close();
  }
});
