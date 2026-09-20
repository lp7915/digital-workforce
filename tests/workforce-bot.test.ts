import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBotConfig } from '../src/workforce/bot-config.ts';
const valid = {
  dedicatedTestBot: true,
  employeeId: 'e',
  appId: 'test-app',
  appSecret: 'test-secret',
  apiKey: 'test-key',
  environmentId: 'env',
  botVaultId: 'vault',
  botTokenCredentialId: 'cred',
  allowedTenantIds: ['tenant'],
  allowedChatIds: ['chat'],
  allowedUserIds: [],
};
test('真实Bot必须明确测试身份、白名单和独立配置；默认不开启个人OAuth', () => {
  assert.equal(parseBotConfig(valid).enableUserOAuth, false);
  assert.throws(() => parseBotConfig({ ...valid, dedicatedTestBot: false }), /生产/);
  assert.throws(() => parseBotConfig({ ...valid, allowedChatIds: ['*'] }), /通配符/);
  assert.throws(() => parseBotConfig({ ...valid, baseUrl: 'https://evil.test/api/v3' }), /官方/);
  assert.throws(() => parseBotConfig({ ...valid, allowedTenantIds: [] }), /租户/);
});
