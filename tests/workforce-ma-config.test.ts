import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaConfiguration } from '../src/workforce/ma-config.ts';
import { LocalWorkspace } from '../src/workforce/workspace.ts';
import { Workforce } from '../src/workforce/domain.ts';
import { createWeb } from '../src/workforce/web.ts';

test('页面配置持久化且优先，状态不包含密钥，空值不覆盖已有配置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ma-config-'));
  try {
    const config = new MaConfiguration(dir, { WORKFORCE_MA_API_KEY: 'env-key' });
    assert.equal(config.apiKey(), 'env-key');
    assert.equal(config.save('test-secret').configured, true);
    assert.equal(new MaConfiguration(dir, {}).apiKey(), 'test-secret');
    assert.equal(statSync(join(dir, 'ma-config.json')).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(config.status()).includes('test-secret'));
    assert.throws(() => config.save(' '), /API Key/);
    assert.equal(config.apiKey(), 'test-secret');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('配置 HTTP 接口只返回状态，拒绝跨站保存且不进入工作台状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ma-config-http-'));
  const workspace = new LocalWorkspace(':memory:');
  const w = new Workforce(':memory:');
  const { server, url } = await createWeb(w, {
    port: 0,
    workspace,
    maConfig: new MaConfiguration(dir, {}, async () => Response.json({ data: [] })),
  });
  try {
    const send = (origin?: string) =>
      fetch(url + '/api/workspace/ma-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify({ apiKey: 'test-secret-http' }),
      });
    assert.equal((await send('https://example.com')).status, 403);
    const saved = await send();
    assert.equal(saved.status, 200);
    assert.ok(!(await saved.text()).includes('test-secret-http'));
    const status = await (await fetch(url + '/api/workspace/ma-config')).json();
    assert.equal(status.configured, true);
    assert.equal(status.connected, true);
    const verified = await fetch(url + '/api/workspace/ma-config/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal((await verified.json()).connected, true);
    assert.equal(status.apiKey, undefined);
    assert.ok(!JSON.stringify(workspace.read()).includes('test-secret-http'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    workspace.close();
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只读验证成功后显示连接状态，更换密钥使旧验证失效', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ma-verify-'));
  try {
    const config = new MaConfiguration(dir, {}, async (url, init) => {
      assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/environments?limit=1');
      assert.equal(init?.method || 'GET', 'GET');
      assert.equal(init?.redirect, 'error');
      return Response.json({ data: [] });
    });
    config.save('key-one');
    assert.equal((await config.verify()).connected, true);
    config.save('key-two');
    assert.equal(config.status().connected, false);
    assert.equal(config.status().verification, 'pending');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('无效密钥、无权限、限流及网络错误均不误报连接且不泄露密钥', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ma-verify-errors-'));
  try {
    for (const code of [401, 403, 429, 500, 200, 0]) {
      const config = new MaConfiguration(dir, {}, async () => {
        if (!code) throw new Error('private-secret');
        return Response.json({ error: 'private-secret' }, { status: code });
      });
      config.save('private-secret');
      const result = await config.verify();
      assert.equal(result.connected, false);
      assert.equal(result.verification, 'failed');
      assert.ok(!JSON.stringify(result).includes('private-secret'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('并发验证共用请求，旧密钥的迟到结果不能覆盖新配置', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ma-verify-race-'));
  let resolveResponse!: (response: Response) => void;
  let calls = 0;
  try {
    const config = new MaConfiguration(dir, {}, async () => {
      calls++;
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    });
    config.save('old-key');
    const first = config.verify();
    const second = config.verify();
    assert.equal(calls, 1);
    config.save('new-key');
    resolveResponse(Response.json({ data: [] }));
    await Promise.all([first, second]);
    assert.equal(config.status().connected, false);
    assert.equal(config.status().verification, 'pending');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
