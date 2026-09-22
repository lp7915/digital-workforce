import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_CONVERSATION_SCOPES,
  missingConversationScopes,
  hasGroupEventScope,
} from '../src/workforce/channel-permissions.ts';
test('业务宽权限缺失不阻塞已授权的卡片对话', () => {
  assert.deepEqual(missingConversationScopes(new Set(REQUIRED_CONVERSATION_SCOPES)), []);
});
test('缺少卡片或表情权限仍阻止启动', () => {
  const scopes = new Set(REQUIRED_CONVERSATION_SCOPES);
  scopes.delete('cardkit:card:write');
  scopes.delete('im:message.reactions:write_only');
  assert.deepEqual(
    new Set(missingConversationScopes(scopes)),
    new Set(['cardkit:card:write', 'im:message.reactions:write_only']),
  );
});

test('进退群事件权限与对话权限独立，接受飞书兼容群信息权限', () => {
  assert.equal(hasGroupEventScope(new Set(REQUIRED_CONVERSATION_SCOPES)), false);
  for (const scope of ['im:chat.members:bot_access', 'im:chat:readonly', 'im:chat:read', 'im:chat'])
    assert.equal(hasGroupEventScope(new Set([scope])), true);
});
