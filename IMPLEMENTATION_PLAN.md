## Stage 1: 独立复用基线
**Goal**: 独立 Git 仓库、复用来源与差异记录、保留成熟链路。
**Success Criteria**: 不复制凭据/数据，不修改旧仓库；既有测试可运行。
**Tests**: 旧项目全部 Node 测试与语法检查。
**Status**: Complete

## Stage 2: 业务模型与记忆
**Goal**: SQLite 持久化版本、项目权限、每轮快照、后台增量任务。
**Success Criteria**: 服务端权限、来源/冲突/撤权/换绑/重启/幂等成立。
**Tests**: workforce-domain 与 workforce-memory 行为测试。
**Status**: In Progress

## Stage 3: Web 与 Bot
**Goal**: 本机认证管理台、版本/项目/记忆/任务页面及独立 Bot 入口。
**Success Criteria**: Web 实际写入；Gateway 注入固定快照、共享群 Session；Bot 显式配置与启停。
**Tests**: HTTP 权限、Gateway 集成、模拟本地验收。
**Status**: Not Started

## Stage 4: 回归与交付
**Goal**: 本地可运行、可验收、清楚标明外部未验证项。
**Success Criteria**: 构建/检查/测试通过，浏览器验收与启动说明完整。
**Tests**: 全量回归与本机 HTTP / UI 验收。
**Status**: Not Started
