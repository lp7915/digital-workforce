import { DomainError } from './domain.ts';

export function personEvidence(messages: any[], source: { id: string; chatId: string }) {
  return messages.flatMap((message) => {
    if (message.type !== 'user.message') return [];
    // 只匹配 Gateway 放在消息开头的身份块；请求正文中的 XML 已被转义。
    const header = message.text.match(
      /^<current_actor open_id="(ou_[a-zA-Z0-9_-]+)" \/>\s*<current_message [^>]*chat_id="([a-zA-Z0-9_-]+)"[^>]*\/>/,
    );
    if (!header || header[2] !== source.chatId) return [];
    return [{ openId: header[1], eventId: message.eventId, sessionId: source.id, chatId: source.chatId }];
  });
}
export function personContent(input: any) {
  if (typeof input.openId !== 'string' || !/^ou_[a-zA-Z0-9_-]{1,128}$/.test(input.openId))
    throw new DomainError('人物身份 ID 无效');
  for (const key of ['name', 'role'])
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 500))
      throw new DomainError('人物姓名或职能无效');
  if (
    !Array.isArray(input.traits) ||
    input.traits.length > 20 ||
    input.traits.some((s: any) => typeof s !== 'string' || !s.trim() || s.length > 500)
  )
    throw new DomainError('人物协作特点无效');
  return {
    path: `people/${input.openId}.md`,
    content: [
      `# ${input.name?.trim() || '姓名未确认'}`,
      `飞书身份：${input.openId}`,
      `姓名：${input.name?.trim() || '未确认'}`,
      `职能：${input.role?.trim() || '未确认'}`,
      '\n## 协作特点',
      ...(input.traits.length ? input.traits.map((t: string) => '- ' + t) : ['尚无已确认信息']),
    ].join('\n'),
  };
}
