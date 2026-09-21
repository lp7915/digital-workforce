## Stage 1: 共用员工运行时
**Goal**: 原 CLI 与工作台使用同一运行时装配，接回流式、表情、附件、上下文、OAuth。
**Success Criteria**: 两个入口调用共同工厂；业务钩子独立。
**Tests**: 运行时装配与 Gateway 回归。
**Status**: Complete

## Stage 2: 初始化与已有应用升级
**Goal**: 复用原员工 Agent 配置、凭证注入和权限集合；已有应用原位补权。
**Success Criteria**: 保留已有 App ID、会话及独立资源；升级进度可见。
**Tests**: 初始化迁移、升级幂等与脱敏。
**Status**: Complete

## Stage 3: 实际验收
**Goal**: 本机启动，验证流式卡片与表情体验。
**Success Criteria**: 权限确认后完成真实消息往返；明确未验证范围。
**Tests**: 完整测试、构建、前端与真实飞书验收。
**Status**: In Progress

代码及完整 1786 项回归测试已通过，补权后自动启动另经 8 项定向测试验证。现有应用实际仅有 4 项基础消息权限，等待用户在飞书确认原位补权，然后验收真实流式卡片与表情。MA Agent 当前版本 1 可原位升级，原会话保留。
