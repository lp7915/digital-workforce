import { failureDiagnostic, safeErrorCode, safeRequestId, sessionFailure } from "./ark-errors.ts";

// 诊断仅包含错误摘要与事件元数据，不转发消息正文、工具参数、环境变量或请求头。
export function diagnosticText(value: unknown, limit = 360): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]*-----/g, "[密钥已隐藏]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL已隐藏]")
    .replace(/\bBearer\s+[^\s,"'}]+/gi, "Bearer [已隐藏]")
    .replace(/(["']?(?:authorization|cookie|set-cookie|[\w-]*(?:token|secret|password|api[_-]?key|credential)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, "$1[已隐藏]")
    .replace(/\b(?:sk-[\w-]+|eyJ[\w.-]+)\b/g, "[凭证已隐藏]")
    .replace(/[A-Za-z0-9_+/=-]{48,}/g, "[长值已隐藏]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, limit);
}

export function localFailure(error: unknown): string {
  const failure = failureDiagnostic(error);
  const candidate = error && typeof error === "object" ? error as Record<string, any> : {};
  // SDK 常把请求配置放在错误对象中；只挑选响应中的诊断字段。
  const data = candidate.response?.data;
  const status = candidate.response?.status;
  const parts = [JSON.stringify(failure)];
  if (Number.isInteger(status) && status >= 400 && status <= 599) parts.push(`HTTP ${status}`);
  if (typeof data?.code === "number" || safeErrorCode(data?.code)) parts.push(`code=${data.code}`);
  const requestId = safeRequestId(data?.log_id);
  if (requestId) parts.push(`request_id=${requestId}`);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "未知异常";
  // 原始 JSON 可能包含完整响应或秘密，保留可读错误，JSON 详情不直传。
  parts.push(diagnosticText(message.includes("{") ? message.slice(0, message.indexOf("{")) + "[结构化详情已省略]" : message));
  return parts.join(" · ").slice(0, 650);
}

export function recentEventSummary(events: unknown[]): string[] {
  return events.slice(-8).map(raw => {
    const e = raw && typeof raw === "object" ? raw as Record<string, any> : {};
    const fields: Record<string, unknown> = {
      id: safeRequestId(e.id) || "未知",
      type: safeErrorCode(e.type) || "未知",
    };
    if (typeof e.processed_at === "string" && /^[0-9T: .+Z-]{1,40}$/.test(e.processed_at)) fields.time = e.processed_at;
    const error = e.error && typeof e.error === "object" ? e.error : {};
    const type = safeErrorCode(error.type), code = safeErrorCode(error.code);
    if (type) fields.error_type = type;
    if (code) fields.error_code = code;
    if (typeof error.code === "number" && Number.isFinite(error.code)) fields.error_code = error.code;
    const failure = sessionFailure(e);
    if (failure.kind !== "unknown") fields.failure = failure;
    if (typeof error.message === "string") {
      try {
        const inner = JSON.parse(error.message)?.error;
        if (safeErrorCode(inner?.code)) fields.upstream_code = inner.code;
        if (safeErrorCode(inner?.param)) fields.parameter = inner.param;
      } catch { fields.error_message = diagnosticText(error.message); }
    }
    return JSON.stringify(fields);
  });
}

export async function gatewayDiagnostic(input: {
  stage: string; messageId: string; sessionId?: string; error: unknown; logs?: string[];
  readEvents?: (id: string, signal: AbortSignal) => Promise<unknown[]>;
  timeoutMs?: number;
}): Promise<string> {
  const lines = ["【Gateway 异常诊断】", `阶段：${input.stage}`, `消息：${diagnosticText(input.messageId)}`,
    `Session：${input.sessionId ? diagnosticText(input.sessionId) : "尚未创建或无法读取"}`,
    `本地错误：${localFailure(input.error)}`, ...(input.logs || []).slice(-8).map(x => `本地阶段记录：${diagnosticText(x, 650)}`)];
  if (!input.sessionId) lines.push("最近 events：无可查询的 Session");
  else if (!input.readEvents) lines.push("最近 events：当前适配器不支持查询");
  else {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const events = await Promise.race([
        input.readEvents(input.sessionId, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("查询 events 超时")); }, input.timeoutMs ?? 5000); })
      ]);
      lines.push("最近 events（最多 8 条，已省略正文和工具输入输出）：", ...(events.length ? recentEventSummary(events) : ["无事件"]));
    } catch (error) { lines.push(`最近 events：查询失败，${localFailure(error)}`); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  lines.push("此诊断不会重跑任务、创建新 Session 或自动解除暂停。");
  return lines.join("\n").slice(0, 11000);
}
