# 实施阶段记录

## Stage 1: 独立复用基线
**Goal**: 建立独立Git仓库与只读复用来源。
**Success Criteria**: 不修改旧项目，不复制真实配置/数据，保留必要MA/Channel/网关与测试。
**Tests**: 原有Node测试。首次失败分为本机端口沙箱限制、未复制测试依赖脚本、旧Git基线引用；均已修复或在允许本机测试端口的环境验证。
**Status**: Complete

## Stage 2: 业务模型与记忆
**Goal**: SQLite版本、项目权限、每轮快照、持久化后台任务。
**Success Criteria**: 管理发布隔离、项目多群共享范围、来源确认、冲突/撤权/换绑/幂等/重启。
**Tests**: workforce-domain、memory、refresh、restart。包括真实子进程退出后的任务恢复，以及普通记忆降级/强制规则失败关闭。
**Status**: Complete

## Stage 3: Web与Bot
**Goal**: 真实HTTP后端、可操作管理台、独立Bot入口与本地验收适配器。
**Success Criteria**: Web写入持久化；Gateway共享排队、话题并行、版本与项目快照；独立Bot白名单、OAuth、流式与附件接线。
**Tests**: workforce-http、gateway、bot、extractor；浏览器创建、编辑、发布、双群读取、来源、纠正等操作。
**Status**: Complete

## Stage 4: 回归与交付
**Goal**: 本地可启动可验收，提供启动说明和真实未验证清单。
**Success Criteria**: 本机服务运行、构建检查通过、全套测试通过、旧源码状态未变化。
**Tests**: 2026-09-20最终 npm test：1757/1757通过，0失败、0跳过；Node语法、Prettier、esbuild与TypeScript 5.9.3检查通过。
**Status**: Complete

四阶段完成指本地实现与验收；真实MA/飞书联调未执行。缺少独立测试凭据与群信息，相关平台override、Vault和流式行为仅有mock契约验证。详细界限见README和outputs/交付说明.md。

按项目约定，实施完成后移除临时IMPLEMENTATION_PLAN.md，保留本阶段记录。
