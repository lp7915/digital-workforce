// 前端演示数据适配层。接入后端时替换 repository，页面不直接发送业务请求。
const storageKey = 'workforce.frontend.v1';
const copy = (value) => structuredClone(value);
const uid = () => crypto.randomUUID();
const initialEmployee = (id, name, description) => ({
  id,
  name,
  description,
  enabled: true,
  identity: '',
  knowledge: '',
  rules: '',
  skills: [],
  memories: [],
  environment: { name: '默认环境', model: '待配置', region: '北京', timeout: 300 },
  credentials: [],
  channels: { feishu: { enabled: false, appId: '' }, doubao: { enabled: false, agentId: '' } },
  versions: [],
  activeVersion: null,
  updatedAt: '2026-09-21T09:00:00+08:00',
});
function snapshot(employee) {
  const { versions, activeVersion, memories, memoryStores, updatedAt, ...configuration } = employee;
  return copy(configuration);
}
function migrateMemories(state) {
  state.tasks ||= initialTasks();
  for (const owner of [...state.employees, ...state.projects]) {
    owner.memoryStores ||= [{ id: 'default', name: '默认记忆库', description: '' }];
    owner.memories.forEach((entry) => {
      entry.storeId ||= owner.memoryStores[0].id;
      entry.path ||= `notes/${entry.id}.md`;
    });
  }
  return state;
}
function initialTasks() {
  return [
    {
      id: 'task-strategy',
      name: '整理上市传播建议',
      type: 'run',
      status: 'running',
      employeeId: 'brand',
      projectId: 'launch',
      progress: '正在整理策略建议',
      detail: '根据项目 Brief 和已确认的项目记忆，整理传播方向与执行建议。',
      steps: ['已完成 · 读取项目上下文', '进行中 · 整理策略建议', '待执行 · 生成交付内容'],
    },
    {
      id: 'task-memory',
      name: '整理项目会议共识',
      type: 'memory',
      status: 'running',
      employeeId: 'brand',
      projectId: 'launch',
      progress: '正在提炼已确认的共识',
      detail: '整理会议中的已确认内容，准备更新项目记忆条目。',
      steps: ['已完成 · 整理会议内容', '进行中 · 提炼项目共识', '待执行 · 更新记忆条目'],
    },
    {
      id: 'task-content',
      name: '生成上市内容初稿',
      type: 'run',
      status: 'queued',
      employeeId: 'content',
      projectId: 'launch',
      progress: '等待策略建议完成',
      detail: '策略建议完成后，生成上市传播内容初稿。',
      steps: ['等待中 · 策略建议', '待执行 · 撰写内容初稿'],
    },
  ];
}
function activeTasks(tasks) {
  return tasks.filter((task) => task.status === 'running' || task.status === 'queued');
}
function memoryTree(entries) {
  const root = { folders: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push({ ...entry, filename: parts.at(-1) });
  }
  return root;
}
function memoryError(owner, values, id) {
  if (!owner.memoryStores.some((store) => store.id === values.storeId)) return '请选择记忆库';
  if (
    !values.path ||
    /[\\\\\x00-\x1f]/.test(values.path) ||
    values.path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return '请填写有效的相对路径，例如 notes/brief.md';
  if (!values.content.trim()) return '请填写文本内容';
  if (
    owner.memories.some(
      (entry) => entry.id !== id && entry.storeId === values.storeId && entry.path === values.path,
    )
  )
    return '该记忆库中已存在相同路径的条目';
  return '';
}
function seed() {
  const strategist = initialEmployee('brand', '品牌策略顾问', '从 Brief 到策略方案，协助团队对齐品牌方向。');
  strategist.identity =
    '你是一位品牌策略顾问，负责分析客户 Brief、梳理品牌定位与传播策略。清楚区分已确认决策与讨论建议。';
  strategist.knowledge = '品牌策略方法\n从目标人群、核心价值、竞争差异三个维度形成策略。';
  strategist.rules = '对外发布前需取得负责人确认。\n不要将项目敏感信息用于其他项目。';
  strategist.skills = [
    { id: 'brief', name: 'Brief 分析', description: '提取业务目标、受众与交付要求', enabled: true },
    { id: 'research', name: '资料整理', description: '整理信息与可追溯来源', enabled: true },
  ];
  strategist.memories = [
    {
      id: 'em1',
      title: '输出偏好',
      content: '策略建议先给结论，再给依据和可执行动作。',
      updatedAt: '2026-09-21T09:00:00+08:00',
    },
  ];
  strategist.environment = { name: '策略协作环境', model: '由 MA 环境提供', region: '北京', timeout: 300 };
  strategist.channels.feishu = { enabled: true, appId: 'cli_demo_brand' };
  strategist.versions = [
    {
      id: 'v1',
      number: 1,
      note: '初始配置',
      createdAt: '2026-09-21T09:00:00+08:00',
      snapshot: snapshot(strategist),
    },
  ];
  strategist.activeVersion = 'v1';
  return {
    employees: [
      strategist,
      initialEmployee('content', '内容创意助手', '协助构思创意、撰写内容与检查表达一致性。'),
    ],
    projects: [
      {
        id: 'launch',
        name: '秋季品牌上市',
        description: '统筹上市传播，沉淀团队共识与项目资料。',
        memories: [
          {
            id: 'pm1',
            title: '上市传播方向',
            content: '以真实用户场景为核心，优先呈现产品的日常使用价值。',
            source: '品牌项目群 · 已确认讨论',
            updatedAt: '2026-09-21T09:15:00+08:00',
          },
        ],
        groups: [
          { id: 'g1', name: '品牌项目群', chatId: 'oc_demo_brand', employeeId: 'brand' },
          { id: 'g2', name: '内容协作群', chatId: 'oc_demo_content', employeeId: 'content' },
        ],
        members: [
          { id: 'm1', name: '项目负责人', account: 'owner@example.com', permission: 'manage' },
          { id: 'm2', name: '内容协作者', account: 'editor@example.com', permission: 'write' },
          { id: 'm3', name: '项目观察员', account: 'viewer@example.com', permission: 'read' },
        ],
      },
    ],
    observations: [
      {
        id: 'run1',
        name: '整理上市传播建议',
        type: 'run',
        status: 'completed',
        employeeId: 'brand',
        projectId: 'launch',
        time: '2026-09-21T09:15:00+08:00',
        duration: '12 秒',
        detail: '已读取项目上下文，生成传播建议。此记录为演示数据。',
        steps: ['接收群聊请求', '加载员工配置与项目记忆', 'MA 执行完成', '回复群聊'],
      },
      {
        id: 'memory1',
        name: '更新项目共识',
        type: 'memory',
        status: 'completed',
        employeeId: 'brand',
        projectId: 'launch',
        time: '2026-09-21T09:16:00+08:00',
        duration: '3 秒',
        detail: '从已确认讨论中整理 1 条项目记忆。此记录为演示数据。',
        steps: ['会话进入空闲', '提炼确认内容', '更新项目记忆'],
      },
      {
        id: 'run2',
        name: '内容渠道连接检查',
        type: 'run',
        status: 'failed',
        employeeId: 'content',
        projectId: '',
        time: '2026-09-21T09:20:00+08:00',
        duration: '1 秒',
        detail: '演示异常：尚未配置渠道标识，请在员工详情中检查渠道配置。',
        steps: ['读取渠道配置', '渠道标识缺失，结束检查'],
      },
    ],
  };
}
const repository = {
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && ['employees', 'projects', 'observations'].every((key) => Array.isArray(saved[key])))
        return migrateMemories(saved);
    } catch {
      /* 浏览器存储不可用时保留当前会话演示。 */
    }
    return migrateMemories(seed());
  },
  save(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  },
};
let data = repository.load();
let search = '',
  statusFilter = 'all',
  typeFilter = 'all',
  dirty = false;
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const date = (value) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const names = { employees: '数字员工', projects: '项目', tasks: '运行中的任务' };
const employeeTabs = {
  basic: '基础信息',
  identity: '身份',
  knowledge: '知识与规则',
  skills: '技能',
  memories: '记忆',
  environment: '环境',
  credentials: '凭证',
  channels: '飞书及豆包',
  versions: '版本控制',
};
const projectTabs = { memories: '项目记忆', groups: '项目群聊', members: '成员及权限' };
function route() {
  const [module = 'employees', id, section] = location.hash.slice(1).split('/');
  return { module: names[module] ? module : 'employees', id, section };
}
const employeeName = (id) => data.employees.find((item) => item.id === id)?.name || '未关联员工';
const projectName = (id) => data.projects.find((item) => item.id === id)?.name || '无项目';
const button = (label, action, id = '', primary = false) =>
  `<button type="button" data-action="${action}" data-id="${esc(id)}" class="${primary ? 'primary' : ''}">${label}</button>`;
const badge = (label, style = '') => `<span class="pill ${style}">${esc(label)}</span>`;
const field = (label, name, value = '', placeholder = '', required = false) =>
  `<label>${label}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} maxlength="500" /></label>`;
const area = (label, name, value = '', rows = 7) =>
  `<label>${label}<textarea name="${name}" rows="${rows}" maxlength="30000">${esc(value)}</textarea></label>`;
const select = (label, name, value, options) =>
  `<label>${label}<select name="${name}">${options.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const panel = (heading, description, body) =>
  `<section class="panel"><h3>${heading}</h3>${description ? `<p class="muted">${description}</p>` : ''}${body}</section>`;
const empty = (title, description) =>
  `<div class="empty"><div class="symbol">◇</div><h3>${title}</h3><p>${description}</p></div>`;
const head = (title, description, action = '') =>
  `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="actions">${action}</div></div>`;
const saveBar = () =>
  '<div class="actions form-actions"><small id="save-state">配置仅保存到当前浏览器</small><button class="primary" type="submit">保存配置</button></div>';
function toast(message) {
  if ($('#modal').open && $('#dialog-feedback')) {
    $('#dialog-feedback').textContent = message;
    return;
  }
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 3500);
}
function commit(message) {
  const persisted = repository.save(data);
  dirty = false;
  render();
  toast(persisted ? message + '（前端演示）' : '当前会话已更新，但浏览器无法持久保存');
}
function modal(title, body) {
  $('#modal-content').innerHTML =
    `<h2 id="modal-title">${esc(title)}</h2>${body}<p id="dialog-feedback" class="error" role="alert"></p>`;
  $('#modal').showModal();
}
function closeModal() {
  $('#modal').close();
}
function tabs(module, id, items, active) {
  return `<nav class="detail-tabs" aria-label="详情导航">${Object.entries(items)
    .map(
      ([key, label]) =>
        `<a href="#${module}/${id}/${key}" class="${active === key ? 'active' : ''}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`,
    )
    .join('')}</nav>`;
}
function render() {
  const { module, id, section } = route();
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === module);
    if (link.dataset.nav === module) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#breadcrumb').textContent = `工作空间 / ${names[module]}`;
  if (module === 'employees' && id) {
    const employee = data.employees.find((item) => item.id === id);
    $('#content').innerHTML = employee
      ? employeeDetail(employee, employeeTabs[section] ? section : 'basic')
      : empty('员工不存在', '请从数字员工列表重新选择。');
  } else if (module === 'projects' && id) {
    const project = data.projects.find((item) => item.id === id);
    $('#content').innerHTML = project
      ? projectDetail(project, projectTabs[section] ? section : 'memories')
      : empty('项目不存在', '请从项目列表重新选择。');
  } else {
    $('#content').innerHTML = module === 'tasks' ? runningTasks() : overview(module);
  }
  applyFilters();
}
function overview(module) {
  const employees = module === 'employees';
  const items = employees ? data.employees : data.projects;
  return (
    head(
      names[module],
      employees ? '配置数字员工，让能力在项目中复用。' : '连接群聊与成员，沉淀共同的项目记忆。',
      button(employees ? '＋ 创建员工' : '＋ 创建项目', employees ? 'new-employee' : 'new-project', '', true),
    ) +
    `<div class="toolbar"><span class="muted">共 ${items.length} ${employees ? '位员工' : '个项目'}</span><input id="search" class="search" aria-label="搜索${names[module]}" placeholder="搜索${names[module]}…" value="${esc(search)}" /></div><div class="grid compact-cards">` +
    items
      .map(
        (item) =>
          `<article class="entity-card" data-search="${esc(item.name + ' ' + item.description)}"><div class="card-top"><span class="entity-icon">${employees ? '◈' : '▦'}</span>${employees ? badge(item.activeVersion ? '已发布' : '草稿', item.activeVersion ? 'green' : '') : badge(`${item.groups.length} 个群聊`)}</div><h3><a href="#${module}/${item.id}">${esc(item.name)}</a></h3><p class="card-description">${esc(item.description || '暂无描述')}</p><div class="card-footer"><span>${employees ? `${item.skills.filter((s) => s.enabled).length} 项技能 · ${item.memories.length} 条记忆` : `${item.memories.length} 条记忆 · ${item.members.length} 位成员`}</span><a href="#${module}/${item.id}" aria-label="查看${esc(item.name)}">查看详情 →</a></div></article>`,
      )
      .join('') +
    `</div><div id="filter-empty" hidden>${empty('没有匹配结果', '换个关键词试试。')}</div>`
  );
}
function employeeDetail(e, section) {
  let content;
  if (section === 'basic')
    content = panel(
      '基础信息',
      '用于识别员工及其服务范围。',
      `<div class="form-grid">${field('名称', 'name', e.name, '输入员工名称', true)}${select(
        '状态',
        'enabled',
        String(e.enabled),
        [
          ['true', '启用'],
          ['false', '停用'],
        ],
      )}<div class="full">${area('描述', 'description', e.description, 3)}</div></div>`,
    );
  if (section === 'identity')
    content = panel(
      '身份',
      '定义员工的角色、职责与能力边界。',
      area('身份提示词', 'identity', e.identity, 12),
    );
  if (section === 'knowledge')
    content =
      panel('知识', '员工跨项目可复用的参考知识。', area('参考知识', 'knowledge', e.knowledge, 8)) +
      panel('规则', '约定员工必须遵守的行为与输出要求。', area('行为规则', 'rules', e.rules, 6));
  if (section === 'environment')
    content = panel(
      '运行环境',
      '仅演示环境配置，实际可选项由后端提供。',
      `<div class="form-grid">${field('环境名称', 'name', e.environment.name)}${field('模型', 'model', e.environment.model)}${select(
        '区域',
        'region',
        e.environment.region,
        [
          ['北京', '北京'],
          ['上海', '上海'],
        ],
      )}<label>运行超时（秒）<input type="number" name="timeout" min="30" max="3600" value="${e.environment.timeout}" required /></label></div>`,
    );
  if (section === 'channels')
    content = ['feishu', 'doubao']
      .map((key) => {
        const channel = e.channels[key];
        const feishu = key === 'feishu';
        return panel(
          feishu ? '飞书' : '豆包',
          '仅保存接入配置，不建立真实连接。',
          `<div class="form-grid">${select('接入状态', key + 'Enabled', String(channel.enabled), [
            ['false', '未启用'],
            ['true', '启用'],
          ])}${field(feishu ? '飞书 App ID' : '豆包 Agent ID', feishu ? 'appId' : 'agentId', feishu ? channel.appId : channel.agentId, '填写渠道标识')}</div>`,
        );
      })
      .join('');
  if (section === 'skills')
    content = `<div class="section-toolbar"><p class="muted">配置员工可以使用的技能。</p>${button('＋ 添加技能', 'add-skill')}</div><div class="grid compact-cards">${e.skills.map((skill) => `<article class="entity-card"><div class="card-top"><span class="entity-icon">◇</span>${badge(skill.enabled ? '已启用' : '已停用', skill.enabled ? 'green' : '')}</div><h3>${esc(skill.name)}</h3><p class="card-description">${esc(skill.description)}</p><div class="actions">${button(skill.enabled ? '停用' : '启用', 'toggle-skill', skill.id)}${button('移除', 'remove-skill', skill.id)}</div></article>`).join('')}</div>${!e.skills.length ? empty('暂无技能', '添加技能，为员工扩展能力。') : ''}`;
  if (section === 'memories') content = memoryList(e, false);
  if (section === 'credentials')
    content = `<div class="section-toolbar"><p class="muted">仅登记凭证名称和引用标识，不接收或保存密钥。</p>${button('＋ 登记凭证', 'add-credential')}</div><div class="grid compact-cards">${e.credentials.map((credential) => `<article class="entity-card"><div class="card-top"><span class="entity-icon">♧</span>${badge('待后端接入')}</div><h3>${esc(credential.name)}</h3><p class="card-description">${esc(credential.reference)}</p><div class="card-footer"><span>凭证引用</span>${button('移除', 'remove-credential', credential.id)}</div></article>`).join('')}</div>${!e.credentials.length ? empty('尚未登记凭证', '登记凭证引用后，由后端完成安全存储与授权。') : ''}`;
  if (section === 'versions')
    content = `<div class="section-toolbar"><p class="muted">保存当前配置快照，演示发布与版本切换。</p>${button('发布版本', 'publish', '', true)}</div><div class="version-stack">${[
      ...e.versions,
    ]
      .reverse()
      .map(
        (version) =>
          `<article class="panel version-card"><div><h3>v${version.number} ${version.id === e.activeVersion ? badge('当前版本', 'green') : ''}</h3><p class="muted">${esc(version.note)} · ${date(version.createdAt)}</p></div><div class="actions">${button('查看配置', 'view-version', version.id)}${version.id !== e.activeVersion ? button('切换到此版本', 'activate-version', version.id) : ''}</div></article>`,
      )
      .join('')}</div>${!e.versions.length ? empty('暂无版本', '完成员工配置后，发布第一个演示版本。') : ''}`;
  const editable = ['basic', 'identity', 'knowledge', 'environment', 'channels'].includes(section);
  return (
    `<a class="back" href="#employees">← 数字员工</a>` +
    head(
      e.name,
      e.description || '完善员工配置',
      badge(e.enabled ? '启用' : '停用', e.enabled ? 'green' : ''),
    ) +
    `<div class="employee-summary"><span>版本<b>${e.activeVersion ? 'v' + e.versions.find((v) => v.id === e.activeVersion)?.number : '未发布'}</b></span><span>技能<b>${e.skills.filter((s) => s.enabled).length}</b></span><span>记忆<b>${e.memories.length}</b></span></div>` +
    tabs('employees', e.id, employeeTabs, section) +
    (editable
      ? `<form id="employee-form" data-section="${section}" class="config-form">${content}${saveBar()}</form>`
      : content)
  );
}
let selectedMemoryStore = '';
let selectedMemoryEntry = '';
let editingMemory = false;
let pendingMemoryAction = null;
function memoryTreeMarkup(node) {
  return (
    [...node.folders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, child]) =>
          `<details open class="memory-folder"><summary>▱ ${esc(name)}</summary><div>${memoryTreeMarkup(child)}</div></details>`,
      )
      .join('') +
    [...node.files]
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map(
        (entry) =>
          `<button type="button" class="memory-file ${entry.id === selectedMemoryEntry ? 'selected' : ''}" data-action="select-memory" data-id="${esc(entry.id)}" title="${esc(entry.path)}" ${entry.id === selectedMemoryEntry ? 'aria-current="true"' : ''}><span aria-hidden="true">▤</span> ${esc(entry.filename)}</button>`,
      )
      .join('')
  );
}
function memoryDocument(entry) {
  if (!entry) return empty('暂无条目', '添加一个路径和文本内容，开始维护记忆。');
  const header = `<div class="memory-document-head"><strong class="memory-path">/${esc(entry.path)}</strong><div class="actions"><small class="muted">更新于 ${date(entry.updatedAt)}</small>${editingMemory ? button('取消', 'cancel-memory') + '<button class="primary" type="submit">保存</button>' : button('删除', 'delete-memory', entry.id) + button('编辑', 'edit-memory', entry.id)}</div></div>`;
  if (editingMemory)
    return `<form id="memory-entry-form" data-kind="memory" data-id="${esc(entry.id)}">${header}<div class="memory-edit-fields"><input type="hidden" name="storeId" value="${esc(entry.storeId)}" />${field('条目路径', 'path', entry.path, 'notes/brief.md', true)}${field('标题（可选）', 'title', entry.title)}${field('来源说明', 'source', entry.source)}</div><label class="memory-editor-label">文本内容<textarea name="content" class="memory-editor" spellcheck="false" maxlength="30000" required>${esc(entry.content)}</textarea></label><div class="memory-document-foot">纯文本 / Markdown · <span id="save-state">编辑后保存到当前浏览器</span></div></form>`;
  return `${header}<div class="memory-code" aria-label="条目文本内容">${entry.content
    .split('\n')
    .map(
      (line, index) =>
        `<div class="memory-code-line"><span class="line-number" aria-hidden="true">${index + 1}</span><pre>${esc(line) || ' '}</pre></div>`,
    )
    .join(
      '',
    )}</div><div class="memory-document-foot"><span>文本内容 · ${new TextEncoder().encode(entry.content).length} B</span><span>${esc(entry.source || '手动维护')}</span></div>`;
}
function memoryList(owner, project) {
  migrateMemories(data);
  const store = owner.memoryStores.find((item) => item.id === selectedMemoryStore);
  if (!store)
    return `<div class="section-toolbar"><p class="muted">${project ? '项目' : '员工'}记忆按记忆库组织，每个条目包含路径和文本内容。</p>${button('＋ 创建记忆库', 'add-store', '', true)}</div><div class="grid compact-cards">${owner.memoryStores.map((item) => `<article class="entity-card"><span class="entity-icon">▤</span><h3>${esc(item.name)}</h3><p class="card-description">${esc(item.description || '通过路径组织长期记忆')}</p><p class="muted">${owner.memories.filter((entry) => entry.storeId === item.id).length} 个条目</p><div class="actions">${button('查看条目', 'open-store', item.id, true)}${button('编辑', 'edit-store', item.id)}</div></article>`).join('')}</div>`;
  const entries = owner.memories.filter((entry) => entry.storeId === store.id);
  const entry = entries.find((item) => item.id === selectedMemoryEntry) || entries[0];
  selectedMemoryEntry = entry?.id || '';
  return `<div class="section-toolbar"><div>${button('← 记忆库', 'back-stores')} <strong>${esc(store.name)}</strong></div>${button('＋ 添加条目', 'add-memory', '', true)}</div><div class="memory-workspace"><nav class="memory-tree" aria-label="记忆路径树"><div class="memory-tree-head"><span>路径树</span><span>${entries.length}</span></div>${memoryTreeMarkup(memoryTree(entries))}</nav><section class="memory-document">${memoryDocument(entry)}</section></div>`;
}
function projectDetail(p, section) {
  let content = '';
  if (section === 'memories') content = memoryList(p, true);
  if (section === 'groups')
    content = `<div class="section-toolbar"><p class="muted">维护项目关联群聊，并指定服务员工。</p>${button('＋ 关联群聊', 'add-group', '', true)}</div><div class="grid compact-cards">${p.groups.map((group) => `<article class="entity-card"><span class="entity-icon">▦</span><h3>${esc(group.name)}</h3><p class="card-description">${esc(group.chatId)}</p><p class="muted">数字员工 · ${esc(employeeName(group.employeeId))}</p><div class="actions">${button('编辑', 'edit-group', group.id)}${button('解除关联', 'remove-group', group.id)}</div></article>`).join('')}</div>${!p.groups.length ? empty('尚未关联群聊', '将群聊关联到项目，组织项目协作。') : ''}`;
  if (section === 'members')
    content = `<div class="section-toolbar"><p class="muted">管理谁可以查看、改写记忆，以及维护成员。</p>${button('＋ 添加成员', 'add-member', '', true)}</div><div class="permission-legend"><span><b>查看</b> 只读项目记忆</span><span><b>改写</b> 可新增、编辑和删除记忆</span><span><b>管理</b> 改写记忆及管理成员</span></div><p class="demo-note">这里演示权限配置；实际鉴权由后端执行。</p><div class="grid compact-cards">${p.members.map((member) => `<article class="entity-card"><div class="card-top"><span class="member-avatar">${esc(member.name.slice(0, 1))}</span>${badge({ read: '查看', write: '改写', manage: '管理' }[member.permission])}</div><h3>${esc(member.name)}</h3><p class="card-description">${esc(member.account)}</p><div class="actions">${button('修改权限', 'edit-member', member.id)}${button('移除', 'remove-member', member.id)}</div></article>`).join('')}</div>`;
  return (
    '<a class="back" href="#projects">← 项目</a>' +
    head(p.name, p.description, button('编辑项目', 'edit-project')) +
    `<div class="employee-summary"><span>项目记忆<b>${p.memories.length}</b></span><span>群聊<b>${p.groups.length}</b></span><span>成员<b>${p.members.length}</b></span></div>` +
    tabs('projects', p.id, projectTabs, section) +
    content
  );
}
function runningTasks() {
  const rows = activeTasks(data.tasks);
  return (
    head('运行中的任务', '查看数字员工正在处理和等待执行的任务。') +
    `<p class="muted">${rows.filter((r) => r.status === 'running').length} 项执行中 · ${rows.filter((r) => r.status === 'queued').length} 项等待中 · 演示进度，不自动更新</p><div class="observation-filters"><input id="search" class="search" aria-label="搜索任务" placeholder="搜索任务、员工或项目…" value="${esc(search)}" />${select(
      '类型',
      'typeFilter',
      typeFilter,
      [
        ['all', '全部类型'],
        ['run', '员工运行'],
        ['memory', '记忆任务'],
      ],
    )}${select('状态', 'statusFilter', statusFilter, [
      ['all', '全部状态'],
      ['running', '执行中'],
      ['queued', '等待中'],
    ])}</div><div class="grid compact-cards">${rows.map((row) => `<article class="entity-card" data-search="${esc(row.name + employeeName(row.employeeId) + projectName(row.projectId))}" data-status="${esc(row.status)}" data-type="${esc(row.type)}"><div class="card-top"><span class="muted">${row.type === 'run' ? '员工任务' : '记忆任务'}</span>${badge(row.status === 'running' ? '执行中' : '等待中', row.status === 'running' ? 'green' : '')}</div><h3>${esc(row.name)}</h3><p class="card-description">${esc(employeeName(row.employeeId))}<br/>${esc(projectName(row.projectId))}</p><p>${esc(row.progress)}</p><div class="card-footer"><span>演示任务</span>${button('查看进度', 'view-task', row.id)}</div></article>`).join('')}</div><div id="filter-empty" hidden>${empty(rows.length ? '没有匹配任务' : '暂无运行中的任务', rows.length ? '调整关键词或筛选条件。' : '数字员工开始执行任务后，将在这里显示。')}</div>`
  );
}
function applyFilters() {
  const cards = document.querySelectorAll('[data-search]');
  let visible = 0;
  cards.forEach((card) => {
    const matches =
      card.dataset.search.toLowerCase().includes(search.toLowerCase()) &&
      (!card.dataset.status || statusFilter === 'all' || card.dataset.status === statusFilter) &&
      (!card.dataset.type || typeFilter === 'all' || card.dataset.type === typeFilter);
    card.hidden = !matches;
    if (matches) visible++;
  });
  if ($('#filter-empty')) $('#filter-empty').hidden = visible > 0;
}
function context() {
  const r = route();
  return {
    ...r,
    owner: (r.module === 'employees' ? data.employees : data.projects).find((item) => item.id === r.id),
  };
}
function editDialog(kind, item = {}) {
  const { owner } = context();
  let title, fields;
  if (kind === 'employee' || kind === 'project') {
    title = (item.id ? '编辑' : '创建') + (kind === 'employee' ? '数字员工' : '项目');
    fields =
      field('名称', 'name', item.name, '填写名称', true) + area('描述', 'description', item.description, 3);
  }
  if (kind === 'memory') {
    title = item.id ? '编辑记忆条目' : '添加记忆条目';
    fields =
      select(
        '记忆库',
        'storeId',
        item.storeId || selectedMemoryStore,
        owner.memoryStores.map((store) => [store.id, store.name]),
      ) +
      field('条目路径', 'path', item.path, '例如 notes/brief.md', true) +
      '<p class="muted">填写库内相对路径；同一记忆库内路径唯一。</p>' +
      field('标题（可选）', 'title', item.title, '一句话说明条目') +
      area('文本内容', 'content', item.content, 12) +
      field('来源说明', 'source', item.source, '例如：已确认的项目会议');
  }
  if (kind === 'store') {
    title = item.id ? '编辑记忆库' : '创建记忆库';
    fields =
      field('记忆库名称', 'name', item.name, '例如 项目共识', true) +
      area('描述', 'description', item.description, 3);
  }
  if (kind === 'group') {
    title = item.id ? '编辑群聊' : '关联群聊';
    fields =
      field('群聊名称', 'name', item.name, '填写群聊名称', true) +
      field('群聊 ID', 'chatId', item.chatId, 'oc_…', true) +
      select(
        '数字员工',
        'employeeId',
        item.employeeId || data.employees[0]?.id,
        data.employees.map((e) => [e.id, e.name]),
      );
  }
  if (kind === 'member') {
    title = item.id ? '修改成员权限' : '添加成员';
    fields =
      field('成员名称', 'name', item.name, '填写名称', true) +
      field('成员标识', 'account', item.account, '邮箱或用户 ID', true) +
      select('项目权限', 'permission', item.permission || 'read', [
        ['read', '查看 · 只读记忆'],
        ['write', '改写 · 新增、编辑、删除记忆'],
        ['manage', '管理 · 改写记忆及管理成员'],
      ]);
  }
  if (kind === 'credential') {
    title = '登记凭证引用';
    fields =
      '<p class="muted">请勿输入 API Key、Secret 或 Token 明文。</p>' +
      field('凭证名称', 'name', '', '例如：资料库凭证', true) +
      field('凭证引用标识', 'reference', '', '例如：credential://knowledge-reader', true);
  }
  if (kind === 'skill') {
    title = '添加技能';
    fields = field('技能名称', 'name', '', '例如：文案校对', true) + area('技能说明', 'description', '', 3);
  }
  if (kind === 'publish') {
    title = '发布演示版本';
    fields =
      '<p class="muted">将当前已保存配置生成本地版本快照，不会发布到 MA。</p>' +
      field('版本说明', 'note', '', '概述本次调整', true);
  }
  modal(
    title,
    `<form id="dialog-form" data-kind="${kind}" data-id="${esc(item.id || '')}" data-owner="${esc(owner?.id || '')}">${fields}<div class="actions form-actions">${button('取消', 'close')}<button class="primary" type="submit">${kind === 'publish' ? '确认发布' : '保存'}</button></div><p class="demo-note">仅更新当前浏览器中的演示数据</p></form>`,
  );
}
function confirmAction(title, text, action, id) {
  modal(
    title,
    `<p>${esc(text)}</p><div class="actions form-actions">${button('取消', 'close')}${button('确认', action, id, true)}</div>`,
  );
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  let action = target.dataset.action,
    id = target.dataset.id;
  if (action === 'discard-memory' && pendingMemoryAction) {
    ({ action, id } = pendingMemoryAction);
    pendingMemoryAction = null;
    dirty = false;
    closeModal();
  }
  const { owner } = context();
  if (action === 'close') return closeModal();
  if (action === 'new-employee') return editDialog('employee');
  if (action === 'new-project') return editDialog('project');
  if (action === 'edit-project') return editDialog('project', owner);
  if (action === 'view-task') {
    const row = data.tasks.find((r) => r.id === id);
    return modal(
      row.name,
      `<p class="muted">${esc(employeeName(row.employeeId))} · ${esc(projectName(row.projectId))}</p>${badge(row.status === 'running' ? '执行中' : '等待中')}<p>${esc(row.detail)}</p><ol class="timeline">${row.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol><p class="muted">前端演示，尚未连接实时任务状态。</p>`,
    );
  }
  if (!owner) return;
  if (['open-store', 'back-stores', 'select-memory', 'cancel-memory', 'add-memory'].includes(action)) {
    if (dirty) {
      pendingMemoryAction = { action, id };
      return confirmAction(
        '放弃未保存的修改？',
        '当前条目的修改尚未保存。取消可继续编辑。',
        'discard-memory',
      );
    }
    dirty = false;
    editingMemory = false;
  }
  if (action === 'select-memory' || action === 'cancel-memory') {
    if (action === 'select-memory') selectedMemoryEntry = id;
    return render();
  }
  if (action === 'open-store' || action === 'back-stores') {
    selectedMemoryEntry = '';
    selectedMemoryStore = action === 'open-store' ? id : '';
    return render();
  }
  if (action === 'edit-store')
    return editDialog(
      'store',
      owner.memoryStores.find((store) => store.id === id),
    );
  if (action.startsWith('add-')) return editDialog(action.slice(4));
  if (action === 'edit-memory') {
    selectedMemoryEntry = id;
    editingMemory = true;
    return render();
  }
  if (action === 'edit-group')
    return editDialog(
      'group',
      owner.groups.find((m) => m.id === id),
    );
  if (action === 'edit-member')
    return editDialog(
      'member',
      owner.members.find((m) => m.id === id),
    );
  if (action === 'toggle-skill') {
    const skill = owner.skills.find((s) => s.id === id);
    skill.enabled = !skill.enabled;
    return commit('技能状态已更新');
  }
  if (action === 'publish') return editDialog('publish');
  if (action === 'view-version') {
    const v = owner.versions.find((r) => r.id === id);
    return modal(
      `v${v.number} 配置快照`,
      `<p class="muted">${esc(v.note)}</p><pre>${esc(JSON.stringify(v.snapshot, null, 2))}</pre>`,
    );
  }
  if (action === 'activate-version')
    return confirmAction(
      '切换版本',
      '切换后将用该版本配置替换当前配置，员工记忆会保留。',
      'confirm-version',
      id,
    );
  if (action === 'confirm-version') {
    const v = owner.versions.find((r) => r.id === id);
    Object.assign(owner, copy(v.snapshot), { activeVersion: v.id });
    closeModal();
    return commit('版本已切换');
  }
  if (action.startsWith('remove-') || action === 'delete-memory')
    return confirmAction('确认移除', '此操作仅移除本地演示记录。', 'confirm-' + action, id);
  if (action.startsWith('confirm-remove-') || action === 'confirm-delete-memory') {
    const collection = {
      'confirm-remove-group': 'groups',
      'confirm-remove-member': 'members',
      'confirm-remove-skill': 'skills',
      'confirm-remove-credential': 'credentials',
      'confirm-delete-memory': 'memories',
    }[action];
    if (!collection) return;
    if (
      collection === 'members' &&
      owner.members.find((m) => m.id === id)?.permission === 'manage' &&
      owner.members.filter((m) => m.permission === 'manage').length === 1
    )
      return toast('请至少保留一位项目管理成员');
    owner[collection] = owner[collection].filter((item) => item.id !== id);
    closeModal();
    return commit('记录已移除');
  }
});
document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  const { owner } = context();
  if (form.id === 'employee-form') {
    const section = form.dataset.section;
    if (section === 'basic') {
      if (!values.name.trim()) return toast('请填写名称');
      Object.assign(owner, {
        name: values.name.trim(),
        description: values.description.trim(),
        enabled: values.enabled === 'true',
      });
    }
    if (section === 'identity') owner.identity = values.identity;
    if (section === 'knowledge') Object.assign(owner, { knowledge: values.knowledge, rules: values.rules });
    if (section === 'environment') owner.environment = { ...values, timeout: Number(values.timeout) };
    if (section === 'channels') {
      if (
        (values.feishuEnabled === 'true' && !values.appId.trim()) ||
        (values.doubaoEnabled === 'true' && !values.agentId.trim())
      )
        return toast('启用渠道前请填写对应标识');
      owner.channels = {
        feishu: { enabled: values.feishuEnabled === 'true', appId: values.appId.trim() },
        doubao: { enabled: values.doubaoEnabled === 'true', agentId: values.agentId.trim() },
      };
    }
    owner.updatedAt = new Date().toISOString();
    return commit('配置已保存');
  }
  if (form.id !== 'dialog-form' && form.id !== 'memory-entry-form') return;
  const kind = form.dataset.kind,
    id = form.dataset.id;
  for (const key of Object.keys(values)) if (key !== 'content') values[key] = values[key].trim();
  if (kind === 'employee') {
    if (!values.name) return toast('请填写名称');
    const item = initialEmployee(uid(), values.name, values.description);
    data.employees.push(item);
    closeModal();
    commit('员工已创建');
    location.hash = `employees/${item.id}`;
    return;
  }
  if (kind === 'project') {
    if (!values.name) return toast('请填写名称');
    if (id) Object.assign(owner, values);
    else
      data.projects.push({
        id: uid(),
        ...values,
        memories: [],
        groups: [],
        members: [{ id: uid(), name: '当前演示用户', account: 'demo-user', permission: 'manage' }],
      });
  }
  if (kind === 'memory') {
    values.path = values.path.trim();
    const error = memoryError(owner, values, id);
    if (error) return toast(error);
    const record = { id: id || uid(), ...values, updatedAt: new Date().toISOString() };
    if (id)
      Object.assign(
        owner.memories.find((m) => m.id === id),
        record,
      );
    else owner.memories.push(record);
    selectedMemoryStore = values.storeId;
    selectedMemoryEntry = record.id;
    editingMemory = false;
  }
  if (kind === 'store') {
    values.name = values.name.trim();
    if (!values.name) return toast('请填写记忆库名称');
    if (id)
      Object.assign(
        owner.memoryStores.find((store) => store.id === id),
        values,
      );
    else owner.memoryStores.push({ id: uid(), ...values });
  }
  if (kind === 'group') {
    if (!values.name || !values.chatId || !values.employeeId) return toast('请补全群聊信息');
    if (owner.groups.some((g) => g.chatId === values.chatId && g.id !== id))
      return toast('该群聊已关联到当前项目');
    if (id)
      Object.assign(
        owner.groups.find((g) => g.id === id),
        values,
      );
    else owner.groups.push({ id: uid(), ...values });
  }
  if (kind === 'member') {
    if (!values.name || !values.account) return toast('请填写成员信息');
    if (owner.members.some((m) => m.account.toLowerCase() === values.account.toLowerCase() && m.id !== id))
      return toast('该成员已存在');
    if (
      id &&
      owner.members.find((m) => m.id === id)?.permission === 'manage' &&
      values.permission !== 'manage' &&
      owner.members.filter((m) => m.permission === 'manage').length === 1
    )
      return toast('请至少保留一位项目管理成员');
    if (id)
      Object.assign(
        owner.members.find((m) => m.id === id),
        values,
      );
    else owner.members.push({ id: uid(), ...values });
  }
  if (kind === 'skill') {
    if (!values.name) return toast('请填写技能名称');
    if (owner.skills.some((s) => s.name === values.name)) return toast('该技能已存在');
    owner.skills.push({ id: uid(), ...values, enabled: true });
  }
  if (kind === 'credential') {
    if (!values.name || !values.reference) return toast('请填写名称与引用标识');
    if (!/^(credential|vault):\/\/[a-zA-Z0-9/_-]+$/.test(values.reference))
      return toast('请填写 credential:// 或 vault:// 开头的引用，不要输入密钥');
    owner.credentials.push({ id: uid(), ...values });
  }
  if (kind === 'publish') {
    if (!values.note) return toast('请填写版本说明');
    const version = {
      id: uid(),
      number: Math.max(0, ...owner.versions.map((v) => v.number)) + 1,
      note: values.note,
      createdAt: new Date().toISOString(),
      snapshot: snapshot(owner),
    };
    owner.versions.push(version);
    owner.activeVersion = version.id;
  }
  closeModal();
  commit(kind === 'publish' ? '演示版本已发布' : '已保存');
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'search') {
    search = event.target.value;
    applyFilters();
  } else if (event.target.closest('#employee-form, #memory-entry-form')) {
    dirty = true;
    if ($('#save-state')) $('#save-state').textContent = '有未保存的修改';
  }
});
document.addEventListener('change', (event) => {
  if (event.target.name === 'typeFilter') {
    typeFilter = event.target.value;
    applyFilters();
  }
  if (event.target.name === 'statusFilter') {
    statusFilter = event.target.value;
    applyFilters();
  }
});
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (link && dirty && !confirm('有未保存的修改，确定离开吗？')) event.preventDefault();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('hashchange', () => {
  selectedMemoryStore = '';
  selectedMemoryEntry = '';
  editingMemory = false;
  dirty = false;
  search = '';
  statusFilter = 'all';
  typeFilter = 'all';
  closeModal();
  render();
  window.scrollTo(0, 0);
});
render();
