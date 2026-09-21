import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DomainError } from './domain.ts';
import type { LocalWorkspace } from './workspace.ts';
import type { WorkspaceChannels } from './channels.ts';

type Run = (args: string[]) => Promise<any>;
const exec = promisify(execFile);
export const runLark: Run = async (args) => {
  let output: string;
  try {
    ({ stdout: output } = await exec('lark-cli', args, {
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    }));
  } catch {
    throw new DomainError('飞书操作失败，请检查本机飞书 CLI 登录、群聊权限及应用可用范围后重试。', 502);
  }
  let result: any;
  try {
    result = JSON.parse(output);
  } catch {
    throw new DomainError('飞书返回数据无效', 502);
  }
  if (result.ok === false || (result.code !== undefined && result.code !== 0))
    throw new DomainError('飞书拒绝操作，请检查当前用户权限及应用可用范围。', 502);
  return result.data ?? result;
};

export class FeishuGroups {
  private workspace: LocalWorkspace;
  private channels: Pick<WorkspaceChannels, 'view'>;
  private run: Run;
  constructor(workspace: LocalWorkspace, channels: Pick<WorkspaceChannels, 'view'>, run: Run = runLark) {
    this.workspace = workspace;
    this.channels = channels;
    this.run = run;
  }
  private async user() {
    const status = await this.run(['auth', 'status', '--json', '--verify']);
    const user = status.identities?.user;
    if (!user?.verified || !user.openId)
      throw new DomainError('请先在本机登录飞书 CLI 用户身份并授权群聊读取、成员管理权限。', 401);
    return user;
  }
  private call(args: string[]) {
    return this.run(['im', ...args, '--as', 'user', '--json']);
  }
  employees() {
    return this.workspace
      .read()
      .state.employees.filter(
        (employee: any) => employee.enabled && this.channels.view(employee.id).status === 'connected',
      )
      .map((employee: any) => ({ id: employee.id, name: employee.name }));
  }
  private async detail(chatId: string, userId: string) {
    if (!/^oc_[a-zA-Z0-9]+$/.test(chatId)) throw new DomainError('群聊 ID 无效');
    const chat = await this.call(['chats', 'get', '--chat-id', chatId, '--user-id-type', 'open_id']);
    const role =
      chat.owner_id === userId ? 'owner' : chat.user_manager_id_list?.includes(userId) ? 'manager' : '';
    if (!role || !['group', 'topic'].includes(chat.chat_mode) || chat.chat_status !== 'normal') return null;
    return { chatId, name: chat.name || '未命名群聊', role };
  }
  async list(pageToken = '') {
    if (pageToken.length > 4096) throw new DomainError('分页参数无效');
    const user = await this.user();
    const page = await this.call([
      '+chat-list',
      '--page-size',
      '100',
      '--sort',
      'active_time',
      ...(pageToken ? ['--page-token', pageToken] : []),
    ]);
    const groups: any[] = [];
    let failed = 0;
    // 限制并发，逐页校验管理员身份；失败的群不作为可操作群返回。
    const chats = page.chats || [];
    for (let i = 0; i < chats.length; i += 5) {
      const results = await Promise.allSettled(
        chats.slice(i, i + 5).map((chat: any) => this.detail(chat.chat_id, user.openId)),
      );
      for (const result of results) {
        if (result.status === 'rejected') failed++;
        else if (result.value) groups.push(result.value);
      }
    }
    return {
      groups,
      scanned: chats.length,
      failed,
      userName: user.userName,
      hasMore: Boolean(page.has_more),
      pageToken: page.page_token || '',
    };
  }
  async import(chatId: string) {
    const user = await this.user();
    const chat = await this.detail(chatId, user.openId);
    if (!chat) throw new DomainError('当前用户不是该群的群主或管理员，或群已解散。', 403);
    return this.persist(chat);
  }
  private persist(chat: { chatId: string; name: string }, employeeId?: string) {
    const latest = this.workspace.read();
    let group = latest.state.groups.find((g: any) => g.chatId === chat.chatId);
    if (!group) {
      group = { id: randomUUID(), ...chat, projectId: '', employeeIds: [], source: 'feishu' };
      latest.state.groups.push(group);
    }
    group.name = chat.name;
    group.source = 'feishu';
    if (employeeId && !group.employeeIds.includes(employeeId)) group.employeeIds.push(employeeId);
    return this.workspace.save(latest.state, latest.revision);
  }
  async add(chatId: string, employeeId: string) {
    const employee = this.workspace.read().state.employees.find((e: any) => e.id === employeeId);
    if (!employee?.enabled) throw new DomainError('请选择已启用的数字员工');
    const binding = this.channels.view(employeeId);
    if (binding.status !== 'connected' || !binding.appId)
      throw new DomainError('请先完成该数字员工的飞书连接');
    const user = await this.user();
    const chat = await this.detail(chatId, user.openId);
    if (!chat) throw new DomainError('当前用户已无此群管理权限，无法添加数字员工。', 403);
    const result = await this.call([
      'chat.members',
      'create',
      '--chat-id',
      chatId,
      '--member-id-type',
      'app_id',
      '--succeed-type',
      '2',
      '--data',
      JSON.stringify({ id_list: [binding.appId] }),
    ]);
    if (result.pending_approval_id_list?.length)
      throw new DomainError('入群申请正在等待飞书审批，审批完成后请再次添加以启用服务。', 409);
    if (result.invalid_id_list?.length || result.not_existed_id_list?.length)
      throw new DomainError('机器人无法入群，请检查应用已发布且对当前用户可见。', 409);
    return this.persist(chat, employeeId);
  }
}
