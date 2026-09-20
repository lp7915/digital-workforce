import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
export type BotConfig = {
  dedicatedTestBot: true;
  employeeId: string;
  appId: string;
  appSecret: string;
  apiKey: string;
  baseUrl: string;
  environmentId: string;
  botVaultId: string;
  botTokenCredentialId: string;
  allowedTenantIds: string[];
  allowedChatIds: string[];
  allowedUserIds: string[];
  enableUserOAuth: boolean;
  timeoutMs: number;
};
export function parseBotConfig(input: any): BotConfig {
  if (!input || input.dedicatedTestBot !== true)
    throw new Error('必须明确声明 dedicatedTestBot=true，禁止复制生产 Bot 配置启动');
  for (const key of [
    'employeeId',
    'appId',
    'appSecret',
    'apiKey',
    'environmentId',
    'botVaultId',
    'botTokenCredentialId',
  ])
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].includes('REPLACE_'))
      throw new Error(`独立测试配置缺少 ${key}`);
  for (const key of ['allowedTenantIds', 'allowedChatIds', 'allowedUserIds'])
    if (
      !Array.isArray(input[key]) ||
      input[key].some((v: unknown) => typeof v !== 'string' || !v || v === '*')
    )
      throw new Error(`${key} 必须为明确的测试范围，不能使用通配符`);
  if (!input.allowedTenantIds.length || (!input.allowedChatIds.length && !input.allowedUserIds.length))
    throw new Error('至少配置一个测试租户和测试群或测试用户');
  const baseUrl = input.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
  const url = new URL(baseUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'ark.cn-beijing.volces.com' ||
    url.pathname !== '/api/v3' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('首版仅允许已配置的方舟北京官方 API 地址');
  const timeoutMs = input.timeoutMs ?? 600000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000)
    throw new Error('timeoutMs 无效');
  return { ...input, baseUrl, timeoutMs, enableUserOAuth: input.enableUserOAuth === true };
}
export function readBotConfig(file: string): BotConfig {
  const path = resolve(file);
  const rel = relative(process.cwd(), path);
  if (rel.startsWith('..') || rel.startsWith('/'))
    throw new Error('测试配置必须放在当前独立项目内，不能加载旧项目配置');
  if (statSync(path).mode & 0o077) throw new Error('配置包含凭据，请先 chmod 600 配置文件');
  return parseBotConfig(JSON.parse(readFileSync(path, 'utf8')));
}
