## Stage 1: 飞书创建与绑定
**Goal**: 添加员工后发起官方应用创建确认，后端持久化绑定和创建状态。
**Success Criteria**: 幂等创建、密钥不返回前端、扫码链接及状态可见。
**Tests**: 创建并发、绑定脱敏、重启中断测试。
**Status**: Complete

## Stage 2: Channel 与 MA
**Goal**: 复用 Gateway 启动独立员工 Channel，转发飞书消息到 MA 并回复。
**Success Criteria**: 独立持久化队列、绑定隔离、配置缺失明确提示。
**Tests**: 接入状态与运行配置校验、现有 Gateway 回归。
**Status**: Complete

## Stage 3: 页面与本地验收
**Goal**: 新增员工自动进入接入向导，已有员工可以继续接入。
**Success Criteria**: 页面展示二维码、绑定状态；真实授权后验证飞书回复。
**Tests**: 工作台测试、构建、浏览器流程；真实外部联调依赖用户确认与 MA 配置。
**Status**: In Progress

当前阻塞：已在页面创建「飞书联调助手」，真实飞书确认链接已生成；等待当前用户扫码确认以及提供 MA 配置路径。代码检查、构建及 1777 项回归测试通过。尚未验证真实 MA 回复，不能标记整体完成。
