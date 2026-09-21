import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from './domain.ts';

export class MaConfiguration {
  private directory: string;
  private path: string;
  private env: NodeJS.ProcessEnv;
  private fetcher: typeof fetch;
  private generation = 0;
  private verification?: { fingerprint: string; connected: boolean; message: string; checkedAt: string };
  private pending?: { fingerprint: string; promise: Promise<ReturnType<MaConfiguration['status']>> };
  constructor(directory: string, env = process.env, fetcher: typeof fetch = fetch) {
    this.directory = resolve(directory);
    this.path = resolve(this.directory, 'ma-config.json');
    this.env = env;
    this.fetcher = fetcher;
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
      const key = this.apiKey();
      const fingerprint = key ? createHash('sha256').update(key).digest('hex') : '';
      const verified = this.verification?.fingerprint === fingerprint ? this.verification : undefined;
      const fresh = verified && Date.now() - Date.parse(verified.checkedAt) < 5 * 60_000;
      return {
        configured: !!key,
        source,
        connected: !!(fresh && verified.connected),
        verification: fresh ? (verified.connected ? 'succeeded' : 'failed') : 'pending',
        checkedAt: verified?.checkedAt,
        message: fresh ? verified.message : key ? '密钥已保存，请验证方舟连接。' : '请先配置方舟 API Key。',
      };
    } catch {
      return { configured: false, source, message: '已有配置不可读取，请重新保存或检查文件权限。' };
    }
  }
  async verify() {
    const key = this.apiKey();
    if (!key) throw new DomainError('请先配置方舟 API Key');
    const fingerprint = createHash('sha256').update(key).digest('hex');
    if (this.pending?.fingerprint === fingerprint) return this.pending.promise;
    const promise = this.probe(key, fingerprint, this.generation);
    this.pending = { fingerprint, promise };
    try {
      return await promise;
    } finally {
      if (this.pending?.promise === promise) this.pending = undefined;
    }
  }
  private async probe(key: string, fingerprint: string, generation: number) {
    let connected = false;
    let message = '';
    const signal = AbortSignal.timeout(8000);
    try {
      // 只读取 MA 环境列表，不创建 Agent、Session 或运行任务；不跟随重定向携带密钥。
      const response = await this.fetcher('https://ark.cn-beijing.volces.com/api/v3/environments?limit=1', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        redirect: 'error',
        signal,
      });
      if (response.ok) {
        const payload = await response.json();
        if (
          payload &&
          !payload.error &&
          (Array.isArray(payload.data) || Array.isArray(payload.data?.items))
        ) {
          connected = true;
          message = '方舟服务已连接，已验证 MA 只读访问权限。';
        } else message = '方舟返回了非预期结果，请重新验证。';
      } else {
        message =
          response.status === 401
            ? 'API Key 无效或已失效，请检查后重新保存。'
            : response.status === 403
              ? '当前 API Key 缺少 MA 访问权限，请检查权限。'
              : response.status === 429
                ? '方舟请求受限，请稍后重新验证。'
                : response.status >= 500
                  ? '方舟服务暂时不可用，请稍后重新验证。'
                  : `方舟验证失败（HTTP ${response.status}），请检查 MA 服务是否已开通。`;
        await response.body?.cancel();
      }
    } catch {
      // 不回传远端响应或异常，避免错误中包含请求头及密钥。
      message = signal.aborted
        ? '连接方舟超时，请检查网络后重新验证。'
        : '无法连接方舟，请检查网络后重新验证。';
    }
    if (this.generation === generation && this.apiKey() === key)
      this.verification = { fingerprint, connected, message, checkedAt: new Date().toISOString() };
    return this.status();
  }
  save(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 4096 || /\s/.test(value.trim()))
      throw new DomainError('请填写有效的 API Key，不能包含空白字符');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = resolve(this.directory, `.ma-config-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify({ apiKey: value.trim() }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      this.verification = undefined;
      this.generation++;
      this.pending = undefined;
    } finally {
      rmSync(temporary, { force: true });
    }
    return this.status();
  }
}
