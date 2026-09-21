import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workforce, DomainError, type Principal, type Job, type Memory, type Turn } from './domain.ts';
import { LocalLab } from './lab.ts';
import { LocalWorkspace } from './workspace.ts';
import type { WorkspaceChannels } from './channels.ts';
import type { MaConfiguration } from './ma-config.ts';
import type { FeishuGroups } from './feishu-groups.ts';
import { initializeAda } from './employee-templates.ts';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
type Access = { id: string; principal: Principal; active: boolean; expiresAt?: number };
export function saveAccessToken(w: Workforce, principal: Principal, token: string, expiresAt?: number) {
  if (token.length < 32) throw new Error('管理令牌至少32字符');
  w.put('access', {
    id: digest(token),
    principal,
    active: true,
    ...(expiresAt ? { expiresAt } : {}),
  } as Access);
}
function authenticate(w: Workforce, req: IncomingMessage): Principal | undefined {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const cookie = req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('wf_session='))
    ?.slice(11);
  const token = bearer || cookie;
  if (!token) return;
  const entry = w.get<Access>('access', digest(token));
  if (entry?.active && (!entry.expiresAt || entry.expiresAt > Date.now())) return entry.principal;
}
async function body(req: IncomingMessage, limit = 160000) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new DomainError('必须使用 application/json', 415);
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) throw new DomainError('请求过大', 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError('JSON 无效');
  }
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
export async function createWeb(
  w: Workforce,
  options: {
    port: number;
    publicDir?: string;
    extractorMode?: string;
    workspace?: LocalWorkspace;
    channels?: WorkspaceChannels;
    maConfig?: MaConfiguration;
    feishuGroups?: FeishuGroups;
  },
) {
  const lab = new LocalLab(w);
  const publicDir = options.publicDir || resolve('public');
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host || '';
      if (!/^127\.0\.0\.1:\d+$/.test(host)) throw new DomainError('只允许本机地址访问', 403);
      const origin = `http://${host}`;
      if (req.headers.origin && req.headers.origin !== origin) throw new DomainError('拒绝跨站请求', 403);
      const url = new URL(req.url || '/', origin);
      const path = url.pathname;
      const method = req.method || 'GET';
      if (options.workspace && path.startsWith('/api/workspace')) {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new DomainError('拒绝跨站请求', 403);
        const workspace = options.workspace;
        if (path === '/api/workspace/employee-templates/ada/initialize' && method === 'POST') {
          await body(req);
          return json(res, initializeAda(workspace));
        }
        if (path === '/api/workspace/feishu-groups' && options.feishuGroups) {
          if (method === 'GET')
            return json(res, await options.feishuGroups.list(url.searchParams.get('pageToken') || ''));
          if (method === 'POST') {
            const input = await body(req);
            if (typeof input.chatId !== 'string') throw new DomainError('请选择飞书群聊');
            return json(res, await options.feishuGroups.import(input.chatId));
          }
        }
        if (path === '/api/workspace/feishu-groups/employees' && options.feishuGroups && method === 'GET')
          return json(res, { employees: options.feishuGroups.employees() });
        if (path === '/api/workspace/feishu-groups/employees' && options.feishuGroups && method === 'POST') {
          const input = await body(req);
          if (typeof input.chatId !== 'string' || typeof input.employeeId !== 'string')
            throw new DomainError('请选择群聊和数字员工');
          return json(res, await options.feishuGroups.add(input.chatId, input.employeeId));
        }
        if (path === '/api/workspace/ma-config' && options.maConfig) {
          if (method === 'GET') return json(res, options.maConfig.status());
          if (method === 'PUT') {
            const input = await body(req, 8192);
            options.maConfig.save(input?.apiKey);
            return json(res, await options.maConfig.verify());
          }
        }
        if (path === '/api/workspace/ma-config/verify' && options.maConfig && method === 'POST') {
          await body(req);
          return json(res, await options.maConfig.verify());
        }
        const upgrade = path.match(/^\/api\/workspace\/employees\/([^/]+)\/feishu\/upgrade$/);
        if (upgrade && options.channels && method === 'POST') {
          await body(req);
          return json(res, options.channels.upgradePermissions(decodeURIComponent(upgrade[1])), 202);
        }
        const channel = path.match(/^\/api\/workspace\/employees\/([^/]+)\/feishu$/);
        if (channel && options.channels) {
          if (method === 'GET') return json(res, options.channels.view(decodeURIComponent(channel[1])));
          if (method === 'POST') {
            const input = await body(req);
            return json(
              res,
              options.channels.begin(decodeURIComponent(channel[1]), input?.confirmedNotCreated === true),
              202,
            );
          }
        }
        if (path === '/api/workspace' && method === 'GET') return json(res, workspace.read());
        if (path === '/api/workspace' && method === 'PUT') {
          const input = await body(req, 4 * 1024 * 1024);
          return json(res, workspace.save(input?.state, input?.revision));
        }
        if (path === '/api/workspace/tasks' && method === 'GET')
          return json(res, { tasks: workspace.tasks() });
        if (path === '/api/workspace/tasks' && method === 'POST')
          return json(res, workspace.enqueue(await body(req)), 201);
        const cancel = path.match(/^\/api\/workspace\/tasks\/([^/]+)\/cancel$/);
        if (cancel && method === 'POST') {
          await body(req);
          return json(res, workspace.cancel(cancel[1]));
        }
        throw new DomainError('工作台接口不存在', 404);
      }
      if (path === '/api/login' && method === 'POST') {
        const input = await body(req);
        if (typeof input?.token !== 'string') throw new DomainError('令牌无效', 401);
        const principal = authenticate(w, {
          headers: { authorization: `Bearer ${input.token}` },
        } as IncomingMessage);
        if (!principal) throw new DomainError('令牌无效或已过期', 401);
        const session = randomBytes(32).toString('hex');
        saveAccessToken(w, principal, session, Date.now() + 8 * 3600000);
        res.setHeader(
          'Set-Cookie',
          `wf_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json(res, { principal });
      }
      if (path.startsWith('/api/')) {
        const actor = authenticate(w, req);
        if (!actor) throw new DomainError('请先使用本机访问令牌登录', 401);
        if (path === '/api/logout' && method === 'POST') {
          const token = req.headers.cookie
            ?.split(';')
            .map((x) => x.trim())
            .find((x) => x.startsWith('wf_session='))
            ?.slice(11);
          if (token) {
            const access = w.get<Access>('access', digest(token));
            if (access) {
              access.active = false;
              w.put('access', access);
            }
          }
          res.setHeader('Set-Cookie', 'wf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json(res, { ok: true });
        }
        if (path === '/api/state' && method === 'GET')
          return json(res, {
            ...w.view(actor),
            upgrades: actor.role === 'admin' ? w.all('upgrade') : [],
            runtimes: actor.role === 'admin' ? w.all('runtime') : [],
            mode: 'local-management',
            extractor: options.extractorMode || 'explicit-confirmation',
          });
        if (path === '/api/employees' && method === 'POST')
          return json(res, w.createEmployee(actor, await body(req)), 201);
        const employee = path.match(/^\/api\/employees\/([^/]+)\/(draft|publish|activate)$/);
        if (employee && method === 'POST') {
          const input = await body(req);
          if (employee[2] === 'draft')
            return json(res, w.saveDraft(actor, employee[1], input.content, input.revision));
          if (employee[2] === 'publish') return json(res, w.publish(actor, employee[1], input.revision));
          return json(res, w.activate(actor, employee[1], input.releaseId));
        }
        if (path === '/api/projects' && method === 'POST')
          return json(res, w.createProject(actor, await body(req)), 201);
        const project = path.match(/^\/api\/projects\/([^/]+)$/);
        if (project && method === 'POST')
          return json(res, w.updateProject(actor, project[1], await body(req)));
        if (path === '/api/bindings' && method === 'POST') return json(res, w.bind(actor, await body(req)));
        const sources = path.match(/^\/api\/memories\/([^/]+)\/sources$/);
        if (sources && method === 'GET') {
          const m = w.get<Memory>('memory', sources[1]);
          if (!m) throw new DomainError('记忆不存在', 404);
          w.manage(actor, m.projectId);
          return json(
            res,
            m.sourceIds
              .map((id) => w.get<Turn>('turn', id))
              .filter((t) => t && !t.direct && t.projectId === m.projectId)
              .map((t) => ({
                id: t!.id,
                chatId: t!.chatId,
                threadId: t!.threadId,
                userId: t!.userId,
                messageId: t!.messageId,
                sessionId: t!.sessionId,
                text: t!.text,
              })),
          );
        }
        const memory = path.match(/^\/api\/memories\/([^/]+)\/(correct|delete|resolve|approve)$/);
        if (memory && method === 'POST')
          return json(res, w.editMemory(actor, memory[1], memory[2], await body(req)));
        if (path === '/api/resources' && method === 'POST')
          return json(res, w.registerResource(actor, await body(req)), 201);
        const resource = path.match(/^\/api\/resources\/([^/]+)\/revoke$/);
        if (resource && method === 'POST') {
          w.revokeResource(actor, resource[1]);
          return json(res, { ok: true });
        }
        if (path === '/api/lab/chat' && method === 'POST')
          return json(res, await lab.chat(actor, await body(req)));
        const job = path.match(/^\/api\/jobs\/([^/]+)\/retry$/);
        if (job && method === 'POST') {
          const j = w.get<Job>('job', job[1]);
          if (!j) throw new DomainError('任务不存在', 404);
          w.manage(actor, j.projectId);
          if (j.state !== 'failed' || !w.jobAllowed(j)) throw new DomainError('只可重试权限仍有效的失败任务');
          j.state = 'scheduled';
          j.retries = 0;
          j.dueAt = Date.now() + 30000;
          w.put('job', j);
          w.audit(actor.id, 'job.retry', j.id);
          return json(res, j);
        }
        throw new DomainError('接口不存在', 404);
      }
      if (method !== 'GET') throw new DomainError('方法不支持', 405);
      const asset = (
        {
          '/': ['index.html', 'text/html'],
          '/app.js': ['app.js', 'text/javascript'],
          '/style.css': ['style.css', 'text/css'],
        } as Record<string, string[]>
      )[path];
      if (!asset) throw new DomainError('页面不存在', 404);
      const data = await readFile(resolve(publicDir, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (error) {
      json(
        res,
        { error: error instanceof DomainError ? error.message : '操作失败，请检查本机服务状态' },
        error instanceof DomainError ? error.status : 500,
      );
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('close', () => lab.close());
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : options.port}`,
  };
}
