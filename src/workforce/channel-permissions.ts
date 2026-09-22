// 对话启动只校验消息投递、卡片和表情；业务域权限按具体工具操作校验。
export const REQUIRED_CONVERSATION_SCOPES = [
  'im:message:send_as_bot',
  'im:message:readonly',
  'im:message.p2p_msg:readonly',
  'im:message.group_at_msg:readonly',
  'im:message:update',
  'im:message.reactions:write_only',
  'cardkit:card:write',
  'cardkit:card:read',
];
export function missingConversationScopes(granted: Set<string>) {
  return REQUIRED_CONVERSATION_SCOPES.filter((scope) => !granted.has(scope));
}

// 消息对话可用不代表进退群事件具备投递权限。
export function hasGroupEventScope(granted: Set<string>) {
  return ['im:chat.members:bot_access', 'im:chat:readonly', 'im:chat:read', 'im:chat'].some((scope) =>
    granted.has(scope),
  );
}
