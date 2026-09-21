let state,
  page = 'employees',
  selectedEmployee,
  tab = 'identity',
  filter = '',
  labBinding = '',
  labThread = '',
  labMessages = [];
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
  );
const labels = {
  active: '生效中',
  conflict: '待处理冲突',
  pending_approval: '待规则审批',
  deleted: '已删除',
  superseded: '已替代',
  revoked: '已撤权',
  scheduled: '等待空闲',
  running: '执行中',
  completed: '已完成',
  paused: '权限变化 · 已暂停',
  failed: '失败',
  idle: '已空闲',
  waiting: '等待授权',
  uncertain: '待核实',
  pending: '待升级',
  current: '当前版本',
  admin: '管理员',
  project_admin: '项目管理员',
  viewer: '只读成员',
};
const badge = (s) =>
  '<span class="pill ' +
  (['active', 'completed', 'idle', 'current'].includes(s)
    ? 'green'
    : ['conflict', 'pending_approval', 'waiting', 'pending', 'scheduled', 'paused'].includes(s)
      ? 'amber'
      : s === 'failed'
        ? 'red'
        : '') +
  '">' +
  esc(labels[s] || s) +
  '</span>';
const date = (n) =>
  n
    ? new Date(n).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const short = (id) => (id ? esc(String(id).slice(0, 8)) : '—');
const admin = () => state?.principal.role === 'admin';
const pname = (id) => state.projects.find((p) => p.id === id)?.name || '未绑定项目';
const ename = (id) => state.employees.find((e) => e.id === id)?.name || id;
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('#toast').hidden = true), 5500);
}
async function api(path, body) {
  const r = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) {
    if (r.status === 401) showLogin();
    throw new Error(v.error || '操作失败');
  }
  return v;
}
function showLogin() {
  $('#login').hidden = false;
  $('#app').hidden = true;
}
async function refresh() {
  state = await api('/state');
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#principal').textContent = state.principal.id + ' · ' + labels[state.principal.role];
  render();
}
const button = (label, action, id = '', primary = false) =>
  '<button ' +
  (primary ? 'class="primary" ' : '') +
  'data-action="' +
  action +
  '" data-id="' +
  esc(id) +
  '">' +
  label +
  '</button>';
const title = (k, h, d, action = '') =>
  '<div class="page-head"><div><p class="eyebrow">' +
  k +
  '</p><h1>' +
  h +
  '</h1><p>' +
  d +
  '</p></div>' +
  action +
  '</div>';
const empty = (h, d) =>
  '<div class="empty"><div class="symbol">◇</div><h3>' + h + '</h3><p>' + d + '</p></div>';
const opt = (items, selected) =>
  items
    .map(
      (x) =>
        '<option value="' +
        esc(x.id) +
        '" ' +
        (x.id === selected ? 'selected' : '') +
        '>' +
        esc(x.name) +
        '</option>',
    )
    .join('');
const field = (label, name, value = '', placeholder = '', readonly = false) =>
  '<label>' +
  label +
  '<input name="' +
  name +
  '" value="' +
  esc(value) +
  '" placeholder="' +
  esc(placeholder) +
  '" ' +
  (readonly ? 'readonly' : '') +
  '></label>';
const area = (label, name, value = '', rows = 6) =>
  '<label>' +
  label +
  '<textarea name="' +
  name +
  '" rows="' +
  rows +
  '" ' +
  (!admin() ? 'readonly' : '') +
  '>' +
  esc(value) +
  '</textarea></label>';
const stat = (label, value, note) =>
  '<div class="stat"><small>' + label + '</small><strong>' + value + '</strong><p>' + note + '</p></div>';
function render() {
  page = location.hash.slice(1) || 'employees';
  if (!['employees', 'projects', 'memories', 'jobs', 'lab'].includes(page)) page = 'employees';
  document
    .querySelectorAll('[data-nav]')
    .forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
  $('#breadcrumb').textContent =
    '工作空间 / ' +
    {
      employees: '数字员工',
      projects: '项目与群聊',
      memories: '项目记忆',
      jobs: '运行与后台任务',
      lab: '本地验收室',
    }[page];
  $('#content').innerHTML = {
    employees: employees,
    projects: projects,
    memories: memories,
    jobs: jobs,
    lab: lab,
  }[page]();
}
function employees() {
  if (selectedEmployee) return employee();
  return (
    title(
      'YOUR DIGITAL TEAM',
      '数字员工',
      '定义清晰的职责，让每位数字员工带着统一规则参与协作。',
      admin() ? button('＋ 创建数字员工', 'new-employee', '', true) : '',
    ) +
    '<div class="stats">' +
    stat('数字员工', state.employees.length, '由管理员统一维护') +
    stat('已发布员工', state.employees.filter((e) => e.releaseId).length, '身份与知识固定为发布快照') +
    stat('服务项目', state.projects.length, '跨群共享经过授权的记忆') +
    stat(
      '有效项目记忆',
      state.memories.filter((m) => m.status === 'active').length,
      '保留确认来源与修订记录',
    ) +
    '</div><div class="toolbar"><h3>团队成员 <span class="count">' +
    state.employees.length +
    '</span></h3><input class="search" id="employee-search" placeholder="搜索员工名称…" aria-label="搜索员工"></div><div class="grid">' +
    state.employees
      .map(
        (e) =>
          '<article class="employee-card" data-name="' +
          esc(e.name) +
          '"><div class="card-top"><div class="employee-icon">◈</div>' +
          badge(e.releaseId ? 'active' : '草稿') +
          '</div><h3>' +
          esc(e.name) +
          '</h3><p class="desc">' +
          esc(
            (e.draft || state.releases.find((r) => r.id === e.releaseId)?.content)?.identity ||
              '尚未配置工作职责',
          ) +
          '</p><div class="card-meta"><span>▦ ' +
          state.bindings.filter((b) => b.employeeId === e.id && b.active).length +
          ' 个群聊</span><span>◷ ' +
          state.releases.filter((r) => r.employeeId === e.id).length +
          ' 个版本</span></div><div class="card-bottom"><span class="muted">' +
          (e.releaseId
            ? '已发布 v' + state.releases.find((r) => r.id === e.releaseId)?.version
            : '等待首次发布') +
          '</span>' +
          button('管理详情 →', 'employee', e.id) +
          '</div></article>',
      )
      .join('') +
    (admin()
      ? '<button class="add-card" data-action="new-employee"><strong>＋</strong><span>创建新的数字员工</span><small>从身份与职责开始</small></button>'
      : '') +
    '</div><div class="info-banner"><span>ⓘ</span><div><b>一致的全局规则，可控的项目记忆</b><p>Identity 与 Knowledge 只能由管理员发布。业务聊天不能改写规则，也不能授予访问权限。</p></div></div>'
  );
}
function employee() {
  const e = state.employees.find((x) => x.id === selectedEmployee);
  if (!e) {
    selectedEmployee = null;
    return employees();
  }
  const releases = state.releases.filter((r) => r.employeeId === e.id).reverse(),
    active = releases.find((r) => r.id === e.releaseId),
    c = e.draft || active?.content || {};
  let editor = '';
  if (tab === 'versions')
    editor =
      '<div class="panel"><h3>不可变发布历史</h3><p class="muted">切回已有快照不会修改历史版本；不安全的原 Session 更新会显示待升级。</p>' +
      releases
        .map(
          (r) =>
            '<div class="list-item"><div class="memory-header"><b>发布版本 v' +
            r.version +
            '</b>' +
            badge(r.id === e.releaseId ? 'active' : '历史版本') +
            '</div><p>' +
            date(r.createdAt) +
            ' · 发布人 ' +
            esc(r.publishedBy) +
            ' · Agent ' +
            esc(r.content.agentVersion || '待配置') +
            '</p><div class="actions">' +
            button('与当前草稿对比', 'compare', r.id) +
            (admin() && r.id !== e.releaseId ? button('切回此版本', 'activate', r.id) : '') +
            '</div></div>',
        )
        .join('') +
      (!releases.length ? empty('尚未发布', '完成身份与知识后发布第一版。') : '') +
      '</div>';
  else
    editor =
      '<form id="draft-form" class="config-form"><section class="panel"><div class="memory-header"><h3>' +
      (tab === 'identity' ? '员工身份 · Identity' : '全局知识 · Knowledge') +
      '</h3><span class="pill">草稿修订 ' +
      e.revision +
      '</span></div><p class="muted">' +
      (tab === 'identity'
        ? '业务身份与真实 Bot 身份分开；应用凭据由独立配置和 Vault 管理。'
        : '强制规则每轮固定加载；参考知识按当前问题匹配。') +
      '</p>' +
      (tab === 'identity'
        ? area('身份、职责与能力边界', 'identity', c.identity, 8) +
          '</section><section class="panel"><h3>MA 配置</h3><p class="muted">设置员工使用的 Agent 与版本。</p><div class="form-grid">' +
          field('MA Agent ID', 'agentId', c.agentId, '真实测试 Agent ID', !admin()) +
          field('固定 Agent 版本', 'agentVersion', c.agentVersion, '例如 1', !admin()) +
          '<div class="full">' +
          field('Skills / Tools 修订标识', 'skillsToolsRevision', c.skillsToolsRevision, '', !admin()) +
          '</div></div>'
        : area('强制规则 · 每轮必须生效', 'rules', c.rules, 6) +
          area('参考知识 · 空行分段，按需读取', 'knowledge', c.knowledge, 9)) +
      '</section>' +
      (admin()
        ? '<div class="actions form-actions"><small>保存不会影响已发布版本</small><button type="button" data-action="preview-draft">预览草稿快照</button><button class="primary">保存草稿</button></div>'
        : '') +
      '</form>';
  return (
    '<a class="back" href="#employees" data-action="back">← 返回数字员工</a>' +
    title(
      'EMPLOYEE PROFILE',
      esc(e.name),
      '管理身份、规则与发布版本。',
      admin() ? button('发布当前草稿', 'publish', '', true) : '',
    ) +
    '<div class="employee-summary"><span>状态<b>' +
    (active ? '已发布' : '草稿') +
    '</b></span><span>版本<b>' +
    (active ? 'v' + active.version : '未发布') +
    '</b></span><span>关联群聊<b>' +
    state.bindings.filter((b) => b.employeeId === e.id && b.active).length +
    '</b></span><span>草稿修订<b>' +
    e.revision +
    '</b></span></div><div class="tabs">' +
    [
      ['identity', '身份与职责'],
      ['knowledge', '知识与强制规则'],
      ['versions', '发布与版本'],
    ]
      .map(
        ([id, label]) =>
          '<button data-action="tab" data-id="' +
          id +
          '" class="' +
          (tab === id ? 'active' : '') +
          '">' +
          label +
          '</button>',
      )
      .join('') +
    '</div><div class="employee-layout"><div>' +
    editor +
    '</div><div class="employee-support"><div class="panel"><h3>当前服务版本</h3><div class="badge-row">' +
    badge(active ? 'active' : '未发布') +
    '<span class="pill">' +
    (active ? 'v' + active.version : '—') +
    '</span></div><p class="muted">' +
    (active ? 'Identity、Knowledge 与工具配置已保存为同一快照。' : '尚无发布快照，业务执行会被服务端阻止。') +
    '</p><div class="meta-list"><span>员工 ID</span><strong>' +
    short(e.id) +
    '</strong><span>发布时间</span><strong>' +
    date(active?.createdAt) +
    '</strong><span>真实 Bot</span><strong>独立配置启停</strong></div></div><div class="panel"><h3>关联群聊</h3>' +
    state.bindings
      .filter((b) => b.employeeId === e.id)
      .map(
        (b) =>
          '<div class="list-item"><b>' +
          esc(b.chatId) +
          '</b><p>' +
          esc(pname(b.projectId)) +
          ' · ' +
          (b.releaseId ? '指定版本' : '跟随员工发布') +
          '</p></div>',
      )
      .join('') +
    '<a href="#projects">前往项目管理 →</a></div></div></div>'
  );
}
function projects() {
  return (
    title(
      'PROJECT WORKSPACE',
      '项目与群聊',
      '一个项目关联多个群聊；共享范围需双方明确配置。',
      admin() ? button('＋ 创建项目', 'new-project', '', true) : '',
    ) +
    state.projects
      .map(
        (p) =>
          '<section class="panel"><div class="memory-header"><div><h3>' +
          esc(p.name) +
          '</h3><small>项目修订 ' +
          p.revision +
          ' · 管理员 ' +
          esc(p.managers.join('、') || '系统管理员') +
          '</small></div><div class="actions">' +
          badge(p.extractionEnabled ? '自动提炼已开启' : '自动提炼已关闭') +
          button('项目设置', 'project-edit', p.id) +
          button('绑定群聊', 'bind', p.id, true) +
          '</div></div><div class="table-wrap"><table><thead><tr><th>群聊 ID</th><th>数字员工</th><th>允许共享的群</th><th>发布策略</th><th>状态</th><th></th></tr></thead><tbody>' +
          state.bindings
            .filter((b) => b.projectId === p.id)
            .map(
              (b) =>
                '<tr><td>' +
                esc(b.chatId) +
                '<small>绑定修订 ' +
                b.revision +
                '</small></td><td>' +
                esc(ename(b.employeeId)) +
                '</td><td>' +
                esc(b.sharedWith.join('、') || '仅来源群') +
                '</td><td>' +
                (b.releaseId
                  ? '指定 v' + state.releases.find((r) => r.id === b.releaseId)?.version
                  : '跟随员工当前发布') +
                '</td><td>' +
                badge(b.active ? 'active' : '已解绑') +
                '</td><td>' +
                button('编辑', 'edit-binding', b.id) +
                '</td></tr>',
            )
            .join('') +
          '</tbody></table></div>' +
          (!state.bindings.some((b) => b.projectId === p.id)
            ? empty('添加第一个群聊', '指定员工和群 ID，再设置可分享范围。')
            : '') +
          '</section>',
      )
      .join('') +
    (!state.projects.length ? empty('从一个项目开始', '创建项目后，可配置群聊与记忆权限。') : '') +
    '<div class="info-banner"><span>ⓘ</span><div><b>项目归属不等于共享权限</b><p>跨群读取需要来源与目标群相互授权。未配置时只对来源群可见。群换绑或撤权会暂停旧后台任务。</p></div></div>'
  );
}
function memories() {
  const list = state.memories
    .filter((m) => !filter || m.projectId === filter)
    .slice()
    .reverse();
  return (
    title('PROJECT MEMORY', '项目记忆', '有来源、有范围、可纠正。只保留后续协作需要的事实与约定。') +
    '<div class="filter"><select id="memory-filter"><option value="">全部获授权项目</option>' +
    opt(state.projects, filter) +
    '</select><span class="count">' +
    list.length +
    ' 条记忆</span>' +
    button('登记长期资料', 'resource') +
    '</div>' +
    list
      .map(
        (m) =>
          '<article class="panel memory-card ' +
          (m.status === 'conflict' ? 'conflict' : '') +
          '"><div class="memory-header"><h3>' +
          esc(m.key) +
          '</h3>' +
          badge(m.status) +
          '</div><p class="memory-value">' +
          esc(m.value) +
          '</p><div class="source-line">' +
          esc(pname(m.projectId)) +
          ' · 来源 ' +
          m.sourceIds.length +
          ' 条 · 可见群 ' +
          esc(m.audiences.join('、')) +
          ' · 修订 ' +
          m.revision +
          ' · ' +
          date(m.createdAt) +
          '</div><div class="actions">' +
          button('查看来源', 'sources', m.id) +
          (!['deleted', 'superseded', 'revoked'].includes(m.status)
            ? button('纠正', 'correct', m.id) +
              button('删除', 'delete-memory', m.id) +
              (m.status === 'conflict' ? button('确认采用此条', 'resolve', m.id, true) : '') +
              (m.status === 'pending_approval' ? button('审批项目规则', 'approve', m.id, true) : '')
            : '') +
          '</div></article>',
      )
      .join('') +
    (!list.length
      ? empty(
          '项目经验将在这里积累',
          '在验收室发送“确认决策：交付日期=10月15日”，连续空闲至少 30 秒后查看结果。',
        )
      : '') +
    '<div class="panel"><h3>长期资料索引</h3><p class="muted">登记权限受控的长期地址，不复制文件字节；远端撤权后应在这里立即撤销。</p>' +
    state.resources
      .map(
        (r) =>
          '<div class="list-item"><b>' +
          esc(r.name) +
          '</b> ' +
          badge(r.active ? 'active' : 'revoked') +
          '<p>' +
          esc(r.uri) +
          '</p>' +
          (r.active ? button('撤销资料访问', 'revoke-resource', r.id) : '') +
          '</div>',
      )
      .join('') +
    '</div>'
  );
}
function jobs() {
  return (
    title(
      'RUNTIME & OBSERVABILITY',
      '运行与后台任务',
      '区分提炼完成、记忆提交和后续可见；会话空闲并不等于业务成功。',
    ) +
    '<div class="stats">' +
    stat('等待整理', state.jobs.filter((j) => j.state === 'scheduled').length, '空闲 30 秒后开始') +
    stat('已提交任务', state.jobs.filter((j) => j.state === 'completed').length, '事务提交与游标同步') +
    stat(
      '需关注',
      state.jobs.filter((j) => ['failed', 'paused'].includes(j.state)).length,
      '失败或权限发生变化',
    ) +
    stat('业务轮次', state.turns.length, '最近 100 条') +
    '</div><div class="panel"><h3>Bot 运行状态</h3>' +
    (state.runtimes?.length
      ? state.runtimes
          .map(
            (r) =>
              '<div class="list-item"><b>' +
              esc(ename(r.employeeId)) +
              '</b> ' +
              badge(r.state === 'running' && Date.now() - r.heartbeat > 20000 ? '心跳已过期' : r.state) +
              '<p>独立应用 ' +
              esc(r.appId) +
              ' · 最近心跳 ' +
              date(r.heartbeat) +
              '</p></div>',
          )
          .join('')
      : '<p class="muted">真实 Bot 尚未启动。使用独立配置和命令显式启动。</p>') +
    (state.upgrades || [])
      .filter((u) => u.state === 'pending')
      .map(
        (u) =>
          '<div class="info-banner">' +
          badge('pending') +
          ' ' +
          esc(u.reason) +
          '；显式 /new 后应用新版，文件不会自动迁移。</div>',
      )
      .join('') +
    '</div><div class="panel"><h3>后台增量任务</h3><div class="table-wrap"><table><thead><tr><th>任务 / 项目</th><th>状态</th><th>事件范围</th><th>最早执行</th><th>结果</th></tr></thead><tbody>' +
    state.jobs
      .slice()
      .reverse()
      .map(
        (j) =>
          '<tr><td>' +
          short(j.id) +
          '<small>' +
          esc(pname(j.projectId)) +
          '</small></td><td>' +
          badge(j.state) +
          '</td><td>' +
          j.sourceIds.length +
          ' 个轮次</td><td>' +
          date(j.dueAt) +
          '</td><td>' +
          (j.state === 'completed'
            ? '提交 ' +
              j.count +
              ' 条 · 耗时 ' +
              Math.max(0, Math.round((j.completedAt - j.createdAt) / 1000)) +
              ' 秒'
            : '重试 ' + j.retries + '/3') +
          '<small>' +
          esc(j.error || '') +
          '</small>' +
          (j.state === 'failed' ? button('重试', 'retry-job', j.id) : '') +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>' +
    (!state.jobs.length ? empty('暂无后台任务', '群聊轮次结束后，后台将持久化增量提炼任务。') : '') +
    '</div><div class="panel"><h3>最近业务轮次</h3><div class="table-wrap"><table><thead><tr><th>群 / 话题</th><th>状态</th><th>实际发布版本</th><th>记忆修订</th><th>时间</th></tr></thead><tbody>' +
    state.turns
      .slice()
      .reverse()
      .map(
        (t) =>
          '<tr><td>' +
          esc(t.chatId) +
          '<small>' +
          esc(t.threadId || '群公共 Session') +
          '</small></td><td>' +
          badge(t.state) +
          '</td><td>' +
          short(t.releaseId) +
          '<small>' +
          short(t.sessionId) +
          '</small></td><td>' +
          t.memoryRevision +
          '</td><td>' +
          date(t.createdAt) +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div></div>'
  );
}
function lab() {
  const bindings = state.bindings.filter((b) => b.active);
  return (
    title(
      'LOCAL ACCEPTANCE LAB',
      '本地验收室',
      '通过真实 Gateway 验证项目路由、版本与记忆。响应来自本地适配器。',
    ) +
    '<div class="info-banner"><span>◎</span><div><b>当前没有调用 MA 或飞书</b><p>这里验证后端行为，不能替代真实 Bot 联调。使用“确认决策：交付日期=10月15日”；空闲 30 秒后换到获准共享的群提问。</p></div></div><div class="two-cols"><div class="panel"><div class="lab-chat">' +
    (labMessages.length
      ? labMessages
          .map(
            (m) =>
              '<div class="bubble ' +
              (m.role === 'user' ? 'user' : '') +
              '"><small>' +
              (m.role === 'user' ? '你 · ' + esc(m.chat) : '本地验收适配器') +
              '</small>' +
              esc(m.text) +
              '</div>',
          )
          .join('')
      : empty('从一条明确的决策开始', '消息会真实进入 Gateway 队列、写入本地轮次记录。')) +
    '</div><form id="lab-form"><div class="form-grid"><label>群聊<select name="binding" required>' +
    bindings
      .map(
        (b) =>
          '<option value="' +
          esc(b.id) +
          '" ' +
          (b.id === labBinding ? 'selected' : '') +
          '>' +
          esc(b.chatId) +
          ' · ' +
          esc(ename(b.employeeId)) +
          '</option>',
      )
      .join('') +
    '</select></label>' +
    field('话题 ID（选填）', 'threadId', labThread, '留空为群公共 Session') +
    '</div><label>消息<textarea name="text" required rows="3" placeholder="确认决策：交付日期=10月15日"></textarea></label><button class="primary" ' +
    (!bindings.length ? 'disabled' : '') +
    '>发送验收消息</button></form></div><div class="panel"><h3>建议验收步骤</h3>' +
    [
      ['01 · 创建与发布', '创建员工并发布身份与知识快照。'],
      ['02 · 配置两个群', '例如 internal-a 与 internal-b，将彼此加入共享范围。'],
      ['03 · 确认与等待', '在 A 确认决策，连续空闲至少 30 秒。'],
      ['04 · 跨群读取', '切到 B 提问，检查记忆与来源。'],
      ['05 · 边界检查', '添加未授权群、修改共享范围、制造冲突或发送 /new。'],
    ]
      .map(([h, d]) => '<div class="list-item"><b>' + h + '</b><p>' + d + '</p></div>')
      .join('') +
    '</div></div>'
  );
}
function modal(html) {
  $('#modal-content').innerHTML = html;
  $('#modal').showModal();
}
function bindingModal(projectId, b) {
  const p = state.projects.find((p) => p.id === projectId);
  modal(
    '<h2>' +
      (b ? '编辑群聊绑定' : '绑定群聊') +
      ' · ' +
      esc(p.name) +
      '</h2><p class="muted">共享需要双方授权。修改后旧任务暂停，原 Session 可能需要显式 /new。</p><form id="binding-form"><input type="hidden" name="projectId" value="' +
      p.id +
      '"><input type="hidden" name="revision" value="' +
      (b?.revision || '') +
      '"><label>数字员工<select name="employeeId" ' +
      (b ? 'disabled' : '') +
      '>' +
      opt(state.employees, b?.employeeId) +
      '</select></label>' +
      field('群聊 ID', 'chatId', b?.chatId || '', 'oc_… 或本地验收群 ID', !!b) +
      field(
        '允许共享的群 ID（逗号分隔）',
        'sharedWith',
        b?.sharedWith.join(', ') || '',
        '未配置时仅来源群可见',
      ) +
      (admin()
        ? '<label>指定发布版本<select name="releaseId"><option value="">跟随员工当前发布</option>' +
          state.releases
            .map(
              (r) =>
                '<option value="' +
                r.id +
                '" ' +
                (b?.releaseId === r.id ? 'selected' : '') +
                '>' +
                esc(ename(r.employeeId)) +
                ' · v' +
                r.version +
                '</option>',
            )
            .join('') +
          '</select></label>'
        : '') +
      '<label class="checkbox-label"><input type="checkbox" name="active" ' +
      (b?.active === false ? '' : 'checked') +
      '>启用此绑定</label><button class="primary">保存绑定</button></form>',
  );
}
document.addEventListener('click', async (event) => {
  const b = event.target.closest('[data-action]');
  if (!b) return;
  event.preventDefault();
  const { action, id } = b.dataset;
  try {
    if (action === 'close') return $('#modal').close();
    if (action === 'refresh') {
      await refresh();
      return toast('已同步最新状态');
    }
    if (action === 'logout') {
      await api('/logout', {});
      return showLogin();
    }
    if (action === 'back') {
      selectedEmployee = null;
      return render();
    }
    if (action === 'employee') {
      selectedEmployee = id;
      tab = 'identity';
      return render();
    }
    if (action === 'tab') {
      tab = id;
      return render();
    }
    if (action === 'new-employee')
      return modal(
        '<h2>创建数字员工</h2><p class="muted">先命名，再定义身份与规则。创建不会启动真实 Bot。</p><form id="employee-form">' +
          field('员工名称', 'name', '', '例如 品牌策略顾问') +
          '<button class="primary">创建员工</button></form>',
      );
    if (action === 'new-project')
      return modal(
        '<h2>创建项目</h2><form id="project-form">' +
          field('项目名称', 'name', '', '例如 秋季品牌上市') +
          field('项目管理员标识（逗号分隔）', 'managers', '', 'project-manager') +
          '<button class="primary">创建项目</button></form>',
      );
    if (action === 'project-edit') {
      const p = state.projects.find((p) => p.id === id);
      return modal(
        '<h2>项目设置</h2><form id="project-edit-form" data-id="' +
          id +
          '">' +
          field('项目名称', 'name', p.name) +
          (admin() ? field('项目管理员标识', 'managers', p.managers.join(', ')) : '') +
          '<label class="checkbox-label"><input name="extractionEnabled" type="checkbox" ' +
          (p.extractionEnabled ? 'checked' : '') +
          '>开启后台自动提炼</label><button class="primary">保存项目</button></form>',
      );
    }
    if (action === 'bind') return bindingModal(id);
    if (action === 'edit-binding') {
      const bind = state.bindings.find((x) => x.id === id);
      return bindingModal(bind.projectId, bind);
    }
    if (action === 'publish') {
      const e = state.employees.find((e) => e.id === selectedEmployee);
      await api('/employees/' + e.id + '/publish', { revision: e.revision });
      await refresh();
      return toast('已发布不可变快照');
    }
    if (action === 'activate') {
      await api('/employees/' + selectedEmployee + '/activate', { releaseId: id });
      await refresh();
      return toast('已切回所选版本');
    }
    if (action === 'preview-draft') {
      const e = state.employees.find((e) => e.id === selectedEmployee);
      return modal(
        '<h2>已保存草稿 · 配置预览</h2><p class="muted">这里预览配置；MA 行为须使用独立测试 Bot 验证。</p><pre>' +
          esc(JSON.stringify(e.draft, null, 2)) +
          '</pre>',
      );
    }
    if (action === 'compare') {
      const r = state.releases.find((r) => r.id === id),
        e = state.employees.find((e) => e.id === r.employeeId);
      return modal(
        '<h2>发布 v' +
          r.version +
          ' 与当前草稿</h2>' +
          Object.keys(r.content)
            .map(
              (key) =>
                '<h3>' +
                esc(key) +
                ' ' +
                badge(r.content[key] === (e.draft || r.content)[key] ? '无变化' : '已修改') +
                '</h3><div class="diff-grid"><pre class="diff-old">' +
                esc(r.content[key] || '（空）') +
                '</pre><pre class="diff-new">' +
                esc((e.draft || r.content)[key] || '（空）') +
                '</pre></div>',
            )
            .join(''),
      );
    }
    if (action === 'sources') {
      const m = state.memories.find((m) => m.id === id),
        sources = await api('/memories/' + id + '/sources');
      return modal(
        '<h2>来源 · ' +
          esc(m.key) +
          '</h2><p class="muted">当前修订 ' +
          m.revision +
          ' · ' +
          (m.correctedBy ? '管理员纠正：' + esc(m.correctedBy) : '经来源确认提炼') +
          '</p>' +
          sources
            .map(
              (t) =>
                '<div class="list-item"><b>' +
                esc(t.chatId) +
                ' / ' +
                esc(t.threadId || '公共群聊') +
                '</b><p>确认人 ' +
                esc(t.userId) +
                ' · 消息 ' +
                esc(t.messageId) +
                ' · Session ' +
                esc(t.sessionId || '—') +
                '</p><pre>' +
                esc(t.text) +
                '</pre><small>来源轮次 ' +
                esc(t.id) +
                '</small></div>',
            )
            .join(''),
      );
    }
    if (action === 'correct') {
      const m = state.memories.find((m) => m.id === id);
      return modal(
        '<h2>纠正项目记忆</h2><p class="muted">原记录保留为已替代，新记录附带纠正身份。</p><form id="correct-form" data-id="' +
          id +
          '"><label>' +
          esc(m.key) +
          '<textarea name="value" required>' +
          esc(m.value) +
          '</textarea></label><button class="primary">保存纠正</button></form>',
      );
    }
    if (['delete-memory', 'resolve', 'approve'].includes(action)) {
      const m = state.memories.find((m) => m.id === id);
      await api('/memories/' + id + '/' + (action === 'delete-memory' ? 'delete' : action), {
        revision: m.revision,
      });
      await refresh();
      return toast('已更新记忆与项目修订');
    }
    if (action === 'resource')
      return modal(
        '<h2>登记长期资料</h2><form id="resource-form"><label>来源项目群<select name="bindingId">' +
          state.bindings
            .filter((b) => b.active)
            .map(
              (b) =>
                '<option value="' +
                esc(b.id) +
                '">' +
                esc(pname(b.projectId)) +
                ' / ' +
                esc(b.chatId) +
                '</option>',
            )
            .join('') +
          '</select></label>' +
          field('资料名称', 'name') +
          field('受权限控制的 HTTPS 链接', 'uri', '', 'https://…') +
          '<button class="primary">登记资料</button></form>',
      );
    if (action === 'revoke-resource') {
      await api('/resources/' + id + '/revoke', {});
      await refresh();
      return toast('资料索引已撤销');
    }
    if (action === 'retry-job') {
      await api('/jobs/' + id + '/retry', {});
      await refresh();
      return toast('已安排重试，仍需通过空闲与权限检查');
    }
  } catch (e) {
    toast(e.message);
  }
});
const split = (s) =>
  String(s || '')
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target,
    data = Object.fromEntries(new FormData(form)),
    submit = form.querySelector('button.primary');
  if (submit) submit.disabled = true;
  try {
    if (form.id === 'login-form') {
      await api('/login', data);
      await refresh();
      return;
    }
    if (form.id === 'employee-form') {
      const e = await api('/employees', data);
      selectedEmployee = e.id;
      tab = 'identity';
    }
    if (form.id === 'project-form') await api('/projects', { ...data, managers: split(data.managers) });
    if (form.id === 'project-edit-form')
      await api('/projects/' + form.dataset.id, {
        name: data.name,
        ...(admin() ? { managers: split(data.managers) } : {}),
        extractionEnabled: form.elements.extractionEnabled.checked,
      });
    if (form.id === 'draft-form') {
      const e = state.employees.find((e) => e.id === selectedEmployee);
      await api('/employees/' + e.id + '/draft', { content: { ...e.draft, ...data }, revision: e.revision });
    }
    if (form.id === 'binding-form') {
      const employeeId = form.elements.employeeId.value,
        current = state.bindings.find((b) => b.chatId === data.chatId && b.employeeId === employeeId);
      await api('/bindings', {
        ...data,
        employeeId,
        sharedWith: split(data.sharedWith),
        active: form.elements.active.checked,
        revision: data.revision ? Number(data.revision) : undefined,
        ...(!admin() && current?.releaseId ? { releaseId: current.releaseId } : {}),
      });
    }
    if (form.id === 'correct-form') {
      const m = state.memories.find((m) => m.id === form.dataset.id);
      await api('/memories/' + m.id + '/correct', { ...data, revision: m.revision });
    }
    if (form.id === 'resource-form') {
      const bind = state.bindings.find((b) => b.id === data.bindingId);
      await api('/resources', { ...data, projectId: bind.projectId });
    }
    if (form.id === 'lab-form') {
      const bind = state.bindings.find((b) => b.id === data.binding);
      labBinding = data.binding;
      labThread = data.threadId;
      labMessages.push({ role: 'user', text: data.text, chat: bind.chatId });
      const r = await api('/lab/chat', {
        employeeId: bind.employeeId,
        chatId: bind.chatId,
        threadId: data.threadId,
        text: data.text,
      });
      labMessages.push({ role: 'assistant', text: r.text || r.error });
      await refresh();
      return;
    }
    $('#modal').close();
    await refresh();
    toast('已保存');
  } catch (e) {
    if (form.id === 'login-form') $('#login-error').textContent = e.message;
    else toast(e.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'employee-search') {
    const q = e.target.value.toLowerCase();
    document
      .querySelectorAll('.employee-card')
      .forEach((card) => (card.hidden = !card.dataset.name.toLowerCase().includes(q)));
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'memory-filter') {
    filter = e.target.value;
    render();
  }
});
window.addEventListener('hashchange', () => {
  if (state) render();
});
setInterval(() => {
  if (state && page === 'jobs' && !$('#modal').open) refresh().catch((e) => toast(e.message));
}, 5000);
refresh().catch(() => showLogin());
