import { randomUUID } from 'node:crypto';
import type { LocalWorkspace } from './workspace.ts';

export function syncBotGroup(
  workspace: LocalWorkspace,
  employeeId: string,
  event: { chatId: string; joined: boolean; name?: string; time?: number },
) {
  if (!event.chatId) return;
  const current = workspace.read();
  if (!current.state.employees.some((e: any) => e.id === employeeId)) return;
  let group = current.state.groups.find((g: any) => g.chatId === event.chatId);
  if (!group) {
    group = {
      id: randomUUID(),
      chatId: event.chatId,
      name: event.name || event.chatId,
      projectId: '',
      employeeIds: [],
      source: 'feishu',
    };
    current.state.groups.push(group);
  }
  group.botEventTimes ||= {};
  const time = event.time || Date.now();
  const storedTime = group.botEventTimes[employeeId] || 0;
  const previousTime = storedTime > 1e14 ? Math.floor(storedTime / 1000) : storedTime;
  if (previousTime >= time) return;
  group.botEventTimes[employeeId] = time;
  group.botRemovedAt ||= {};
  if (event.joined) delete group.botRemovedAt[employeeId];
  else group.botRemovedAt[employeeId] = time;
  if (event.name) group.name = event.name;
  group.employeeIds = group.employeeIds.filter((id: string) => id !== employeeId);
  if (event.joined) group.employeeIds.push(employeeId);
  group.source = 'feishu';
  workspace.save(current.state, current.revision);
}

// 仅用于已通过飞书 Channel 验证的实时消息，不接受客户端提交的群关系。
export function syncMessageGroup(
  workspace: LocalWorkspace,
  employeeId: string,
  message: { conversationType: string; conversationId: string; createTime: number },
) {
  if (message.conversationType !== 'group' || !Number.isFinite(message.createTime) || message.createTime <= 0)
    return;
  const state = workspace.read().state;
  if (!state.employees.some((e: any) => e.id === employeeId && e.enabled)) return;
  const group = state.groups.find((g: any) => g.chatId === message.conversationId);
  // 明确退群后，迟到或重放的消息不能恢复在群状态；只接受新的进群事件。
  if (group?.botRemovedAt?.[employeeId]) return;
  if (group?.employeeIds.includes(employeeId)) return;
  syncBotGroup(workspace, employeeId, {
    chatId: message.conversationId,
    joined: true,
    time: message.createTime,
  });
}
