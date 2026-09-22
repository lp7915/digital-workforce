# 最终产物契约 v1

所有文件放在单独的本轮目录；不允许符号链接。输出使用 UTF-8，每个文件不超过 20 MB。

`output-manifest.json`：

```json
{
  "schema_version": 1,
  "run_id": "run-20260922-001",
  "project_id": "project-example",
  "period": {"start":"2026-09-14T00:00:00+08:00","end":"2026-09-21T00:00:00+08:00"},
  "input_sha256": "原始输入文件的64位SHA256",
  "delivery_status": "draft",
  "files": {
    "events.json": "文件SHA256",
    "quality.json": "文件SHA256",
    "review-items.json": "文件SHA256",
    "report.md": "文件SHA256",
    "report.html": "文件SHA256"
  }
}
```

示例哈希必须替换为实际文件的 SHA256。先完成文件，再用 Python `hashlib.sha256(path.read_bytes()).hexdigest()` 计算，不能手写占位值。

- events.json：顶层包含与清单一致的 run_id、project_id、period、input_sha256，另有非空 events 数组；每个事件必须有唯一 event_id 和非空 source_urls 数组（HTTP(S) URL，无内嵌凭证）。其余分析字段可保留。
- quality.json：复用数据 Skill 实际产生的质量文件，input_sha256、period_start / period_end 与清单中的 period.start / period.end 一致，valid_count 为正整数。不能将 approved:false 改写成真实人工审批；样本验收记录另行复核。
- review-items.json：包含同样的四个上下文字段及 items 数组。没有问题时为 []；有问题时每项须包含 status:"resolved" 与非空 resolution 处理依据。不要删除未解决项绕过验证。
- report.md 与 report.html：必须包含“一句话结论、周期与质量、热点格局、传播变化、内容机会、风险与行动、事件清单、行动建议、来源与限制”；列出本轮每个事件 ID 及至少一个对应来源链接。不能残留 TODO/TBD/模板占位符。
- HTML 使用完整静态 html/body，样式写在固定 style 标签中；不允许脚本、事件属性、内联 style、iframe、表单、SVG、外部样式或非 HTTP(S) 资源。动态文本一律转义。
- validation.json：由脚本产生。status 为 failed 或 draft_validated，errors 包含 code/file/message，另有本次读取文件的 SHA256。禁止手工改写验证结果。

## 验证边界

哈希用于识别本轮文件是否变化，不是可信签名。事件引用检查不等于证明来源真实或数字正确，HTML 检查也不是通用浏览器安全沙箱。必须再做 SKILL.md 要求的语义复核。真实网页或飞书发布状态需独立回读验证，不能用本地 manifest 自证。
