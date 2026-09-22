import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { MaEnvironments } from '../src/workforce/ma-environments.ts';
import { ArkHttpError, LARK_CLI_SETUP_SCRIPT } from '../src/ark.ts';

function fixture() {
  const workspace = new LocalWorkspace(':memory:');
  const rows: any[] = [
    {
      id: 'env-other',
      name: '其他应用环境',
      config: {
        type: 'cloud',
        env: { LARKSUITE_CLI_APP_ID: 'cli_other', SECRET: 'never-expose' },
        setup_script: 'private-script',
      },
    },
    { id: 'env-basic', name: '基础环境', config: { type: 'cloud' } },
  ];
  let creates = 0;
  const service = new MaEnvironments(
    workspace,
    {
      all: async () => rows,
      call: async (path: string) => {
        const row = rows.find((e) => path === '/environments/' + e.id);
        if (!row) throw Error('不存在');
        return row;
      },
    } as any,
    async () => {
      creates++;
      const e = {
        id: 'env-recommended',
        name: 'workforce-lark-cli-recommended',
        config: { type: 'cloud', setup_script: LARK_CLI_SETUP_SCRIPT, env: {} },
      };
      rows.push(e);
      return e;
    },
  );
  return { workspace, service, rows, count: () => creates };
}
test('推荐 MA 环境并发初始化仅创建一次，列表不返回脚本和环境变量', async () => {
  const f = fixture();
  try {
    const ids = await Promise.all([f.service.ensureRecommended(), f.service.ensureRecommended()]);
    assert.deepEqual(ids, ['env-recommended', 'env-recommended']);
    assert.equal(f.count(), 1);
    const result = await f.service.list('cli_current');
    assert.equal(result.recommendedId, 'env-recommended');
    assert.equal(result.environments.find((e) => e.id === 'env-other')?.compatible, false);
    assert.ok(!JSON.stringify(result).includes('never-expose'));
    assert.ok(!JSON.stringify(result).includes('private-script'));
    assert.equal(result.environments.find((e) => e.id === 'env-recommended')?.larkCli, 'startup');
  } finally {
    f.workspace.close();
  }
});
test('保存环境验证真实资源并拒绝其他应用的固定身份', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.validate('env-other', 'cli_current'), /其他飞书应用/);
    await assert.rejects(f.service.validate('../invalid', 'cli_current'), /ID/);
    assert.equal((await f.service.validate('env-basic', 'cli_current')).id, 'env-basic');
  } finally {
    f.workspace.close();
  }
});

test('推荐环境被 MA 明确拒绝后允许修正重试，未知结果不重复创建', async () => {
  const workspace = new LocalWorkspace(':memory:');
  let calls = 0;
  const service = new MaEnvironments(workspace, { all: async () => [] } as any, async () => {
    calls++;
    if (calls === 1) throw new ArkHttpError('参数错误', 400);
    throw new Error('连接中断');
  });
  try {
    await assert.rejects(service.ensureRecommended(), /参数错误/);
    await assert.rejects(service.ensureRecommended(), /连接中断/);
    await assert.rejects(service.ensureRecommended(), /未确认/);
    assert.equal(calls, 2);
  } finally {
    workspace.close();
  }
});

test('推荐环境改名后按已登记 ID 复用，不创建重复资源', async () => {
  const f = fixture();
  try {
    const id = await f.service.ensureRecommended();
    f.rows.find((row) => row.id === id).name = '历史环境名称';
    assert.equal(await f.service.ensureRecommended(), id);
    assert.equal((await f.service.list()).recommendedId, id);
    assert.equal(f.count(), 1);
  } finally {
    f.workspace.close();
  }
});
