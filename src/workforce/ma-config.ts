import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError } from './domain.ts';

export class MaConfiguration {
  private directory: string;
  private path: string;
  private env: NodeJS.ProcessEnv;
  constructor(directory: string, env = process.env) {
    this.directory = resolve(directory);
    this.path = resolve(this.directory, 'ma-config.json');
    this.env = env;
  }
  private fileKey(path: string) {
    if (statSync(path).mode & 0o077) throw new Error('MA 配置文件权限须为 600');
    const value = JSON.parse(readFileSync(path, 'utf8')).apiKey;
    if (typeof value !== 'string' || !value.trim()) throw new Error('MA 配置无效');
    return value.trim();
  }
  apiKey(): string | undefined {
    if (existsSync(this.path)) return this.fileKey(this.path);
    if (this.env.WORKFORCE_MA_CONFIG) return this.fileKey(resolve(this.env.WORKFORCE_MA_CONFIG));
    return this.env.WORKFORCE_MA_API_KEY?.trim() || undefined;
  }
  status() {
    const source = existsSync(this.path)
      ? '页面配置'
      : this.env.WORKFORCE_MA_CONFIG
        ? '配置文件'
        : this.env.WORKFORCE_MA_API_KEY
          ? '环境变量'
          : '';
    try {
      return {
        configured: !!this.apiKey(),
        source,
        message: '保存不代表密钥已通过方舟验证；实际接入时验证。',
      };
    } catch {
      return { configured: false, source, message: '已有配置不可读取，请重新保存或检查文件权限。' };
    }
  }
  save(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 4096 || /\s/.test(value.trim()))
      throw new DomainError('请填写有效的 API Key，不能包含空白字符');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = resolve(this.directory, `.ma-config-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify({ apiKey: value.trim() }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    return this.status();
  }
}
