import test from 'node:test';
import assert from 'node:assert/strict';
import { Workforce } from '../src/workforce/domain.ts';
import { createWeb, saveAccessToken } from '../src/workforce/web.ts';
const admin = { id: 'admin', role: 'admin' } as const;
test('HTTP后端认证、草稿发布和越权检查真实生效，不接受跨站写入', async () => {
  const w = new Workforce(':memory:');
  saveAccessToken(w, admin, 'a'.repeat(48));
  saveAccessToken(w, { id: 'reader', role: 'viewer' }, 'v'.repeat(48));
  const { server, url } = await createWeb(w, { port: 0 });
  const api = (path: string, method = 'GET', body?: unknown, token = 'a'.repeat(48), origin?: string) =>
    fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await fetch(url + '/api/state')).status, 401);
    assert.equal((await api('/api/employees', 'POST', { name: '越权' }, 'v'.repeat(48))).status, 403);
    assert.equal(
      (await api('/api/employees', 'POST', { name: '跨站' }, 'a'.repeat(48), 'https://evil.test')).status,
      403,
    );
    const response = await api('/api/employees', 'POST', { name: '策划助理' });
    assert.equal(response.status, 201);
    const e = await response.json();
    assert.equal((await api(`/api/employees/${e.id}/publish`, 'POST', { revision: 1 })).status, 200);
    const state = await (await api('/api/state')).json();
    assert.equal(state.employees[0].name, '策划助理');
    const login = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(48) }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    w.close();
  }
});
