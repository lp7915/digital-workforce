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
  if (!group && !event.joined) return;
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
  if ((group.botEventTimes[employeeId] || 0) >= time) return;
  group.botEventTimes[employeeId] = time;
  if (event.name) group.name = event.name;
  group.employeeIds = group.employeeIds.filter((id: string) => id !== employeeId);
  if (event.joined) group.employeeIds.push(employeeId);
  group.source = 'feishu';
  const project = current.state.projects.find((p: any) => p.id === group.projectId);
  if (event.joined && project && !project.employees.some((e: any) => e.id === employeeId))
    project.employees.push({ id: employeeId, role: '', permission: 'read' });
  workspace.save(current.state, current.revision);
}
