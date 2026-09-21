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
  const { server, url } = await createWeb(w, { port: 0, workspace, maConfig: new MaConfiguration(dir, {}) });
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
    assert.equal(status.apiKey, undefined);
    assert.ok(!JSON.stringify(workspace.read()).includes('test-secret-http'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    workspace.close();
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
