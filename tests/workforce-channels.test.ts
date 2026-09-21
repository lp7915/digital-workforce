import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { WorkspaceChannels, qrModules } from '../src/workforce/channels.ts';

function workspace() {
  const w = new LocalWorkspace(':memory:');
  w.save(
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
  return w;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(check(), '异步状态未完成');
}
test('应用创建幂等，确认后才绑定，密钥不返回页面', async () => {
  const w = workspace();
  let finish: any,
    count = 0,
    stopped = false;
  const channels = new WorkspaceChannels(w, {
    dataDir: '/tmp',
    register: async (options) => {
      count++;
      assert.equal(options.createOnly, true);
      options.onQRCodeReady({ url: 'https://open.feishu.cn/confirm', expireIn: 60 });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    provision: async () => {},
    connect: async () => async () => {
      stopped = true;
    },
  });
  try {
    channels.begin('e');
    channels.begin('e');
    assert.equal(count, 1);
    assert.equal(channels.view('e').status, 'awaiting_confirmation');
    finish({
      client_id: 'cli_test',
      client_secret: 'sensitive-secret',
      user_info: { open_id: 'ou_creator' },
    });
    await until(() => channels.view('e').status === 'connected');
    assert.equal(channels.view('e').appId, 'cli_test');
    assert.ok(!JSON.stringify(channels.view('e')).includes('sensitive-secret'));
    assert.equal(channels.view('e').url, undefined);
    channels.begin('e');
    assert.equal(count, 1);
  } finally {
    await channels.stop();
    w.close();
  }
  assert.equal(stopped, true);
});
test('后续步骤失败保留应用，重试不创建第二个应用，错误不泄露密钥', async () => {
  const w = workspace();
  let count = 0;
  const channels = new WorkspaceChannels(w, {
    dataDir: '/tmp',
    register: async () => {
      count++;
      return { client_id: 'cli_test', client_secret: 'secret' };
    },
    provision: async () => {
      throw new Error('request contained secret');
    },
  });
  try {
    channels.begin('e');
    await until(() => channels.view('e').status === 'error');
    assert.ok(!JSON.stringify(channels.view('e')).includes('secret'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    channels.begin('e');
    await until(() => channels.view('e').status === 'error');
    assert.equal(count, 1);
  } finally {
    await channels.stop();
    w.close();
  }
});
test('未确认创建在重启后不自动重复申请，状态隔离于客户端工作台数据', async () => {
  const w = workspace();
  w.db.exec('CREATE TABLE workspace_channels (employee_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  w.db
    .prepare('INSERT INTO workspace_channels VALUES (?,?)')
    .run('e', JSON.stringify({ employeeId: 'e', status: 'creating' }));
  const channels = new WorkspaceChannels(w, { dataDir: '/tmp' });
  try {
    assert.equal(channels.view('e').status, 'interrupted');
    assert.throws(() => channels.begin('e'), /核查/);
    assert.throws(() => channels.view('missing'), /不存在/);
    assert.ok(!JSON.stringify(w.read()).includes('workspace_channels'));
    const modules = qrModules('https://open.feishu.cn/confirm');
    assert.ok(modules.length > 20 && modules.every((row: any[]) => row.length === modules.length));
  } finally {
    await channels.stop();
    w.close();
  }
});
