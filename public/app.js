// 浏览器旧数据仅用于首次导入；连接后以本机 SQLite 工作台为准。
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
  state.groups ||= state.projects.flatMap((project) =>
    project.groups.map((group) => ({
      ...group,
      id: `${project.id}:${group.id}`,
      projectId: project.id,
      employeeIds: group.employeeIds || (group.employeeId ? [group.employeeId] : []),
      source: 'project',
    })),
  );
  syncProjectGroups(state);
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
function syncProjectGroups(state) {
  for (const project of state.projects)
    project.groups = state.groups
      .filter((group) => group.projectId === project.id)
      .map((group) => ({ ...group, employeeId: group.employeeIds[0] || '' }));
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
let serverRevision = 0;
let confirmedData = null;
let connected = false;
let saving = false;
async function request(path, method = 'GET', body) {
  const response = await fetch('/api/workspace' + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本机服务请求失败');
  return result;
}
function acceptServer(result) {
  serverRevision = result.revision;
  data = migrateMemories(result.state);
  confirmedData = copy(data);
}
async function connectWorkspace() {
  $('#content').innerHTML = '<div class="empty">正在连接本机服务…</div>';
  try {
    let result = await request('');
    if (!result.initialized) {
      const initial = migrateMemories(repository.load());
      initial.tasks = [];
      try {
        result = await request('', 'PUT', { revision: 0, state: initial });
      } catch (error) {
        result = await request('');
        if (!result.initialized) throw error;
      }
    }
    acceptServer(result);
    connected = true;
    $('#workspace-status').textContent = '本机服务已连接';
    void refreshMaStatus();
    render();
  } catch (error) {
    connected = false;
    $('#workspace-status').textContent = '本机服务未连接';
    paintMaStatus(null);
    $('#content').innerHTML =
      empty('无法连接本机工作台', esc(error.message)) + button('重试连接', 'reconnect', '', true);
  }
}
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
const names = { employees: '数字员工', projects: '项目', tasks: '运行中的任务', groups: '群聊' };
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
let selectCounter = 0;
const select = (label, name, value, options) => {
  const id = `select-${++selectCounter}`;
  const selected = options.find(([key]) => key === value) || options[0];
  return `<label class="select-field" for="${id}"><span id="${id}-label">${esc(label)}</span><span class="ui-select"><input type="hidden" name="${esc(name)}" value="${esc(selected?.[0] || '')}" /><button type="button" id="${id}" class="select-trigger" role="combobox" aria-labelledby="${id}-label" aria-expanded="false" aria-haspopup="listbox" aria-controls="${id}-list" ${!options.length ? 'disabled' : ''}><span class="select-value">${esc(selected?.[1] || '暂无选项')}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m8 9 4-4 4 4M8 15l4 4 4-4"/></svg></button><span id="${id}-list" class="select-menu" role="listbox" aria-labelledby="${id}-label" popover="auto">${options.map(([key, text], index) => `<span id="${id}-option-${index}" class="select-option" role="option" aria-selected="${key === selected?.[0]}" data-value="${esc(key)}"><span>${esc(text)}</span><span class="select-check" aria-hidden="true">✓</span></span>`).join('')}</span></span></label>`;
};
function openSelect(trigger) {
  const menu = document.getElementById(trigger.getAttribute('aria-controls'));
  if (menu.matches(':popover-open')) {
    menu.hidePopover();
    return;
  }
  menu.showPopover();
  const rect = trigger.getBoundingClientRect();
  menu.style.width = Math.min(rect.width, innerWidth - 16) + 'px';
  menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  const below = innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const upwards = below < Math.min(menu.scrollHeight, 240) && above > below;
  menu.style.maxHeight = Math.max(60, Math.min(280, upwards ? above : below)) + 'px';
  menu.style.top = (upwards ? Math.max(8, rect.top - menu.offsetHeight - 5) : rect.bottom + 5) + 'px';
  trigger.setAttribute('aria-expanded', 'true');
  const selected = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
  focusSelectOption(trigger, selected);
  menu.ontoggle = () => {
    const open = menu.matches(':popover-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) trigger.removeAttribute('aria-activedescendant');
  };
}
function focusSelectOption(trigger, option) {
  if (!option) return;
  const menu = option.parentElement;
  menu
    .querySelectorAll('.select-option')
    .forEach((item) => item.classList.toggle('highlighted', item === option));
  trigger.setAttribute('aria-activedescendant', option.id);
  option.scrollIntoView({ block: 'nearest' });
}
function chooseSelectOption(option) {
  const wrapper = option.closest('.ui-select');
  const input = wrapper.querySelector('input');
  const trigger = wrapper.querySelector('.select-trigger');
  input.value = option.dataset.value;
  trigger.querySelector('.select-value').textContent = option.firstElementChild.textContent;
  option.parentElement
    .querySelectorAll('[role="option"]')
    .forEach((item) => item.setAttribute('aria-selected', String(item === option)));
  option.parentElement.hidePopover();
  trigger.setAttribute('aria-expanded', 'false');
  trigger.removeAttribute('aria-activedescendant');
  trigger.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function closeSelectMenus() {
  document.querySelectorAll('.select-menu:popover-open').forEach((menu) => menu.hidePopover());
}
window.addEventListener('resize', closeSelectMenus);
document.addEventListener(
  'scroll',
  (event) => {
    if (!event.target.closest?.('.select-menu')) closeSelectMenus();
  },
  true,
);
document.addEventListener('click', (event) => {
  const option = event.target.closest('.select-option');
  const trigger = event.target.closest('.select-trigger');
  if (option) {
    event.preventDefault();
    chooseSelectOption(option);
  } else if (trigger) {
    event.preventDefault();
    openSelect(trigger);
  }
});
document.addEventListener('keydown', (event) => {
  const trigger = event.target.closest('.select-trigger');
  if (!trigger) return;
  const menu = document.getElementById(trigger.getAttribute('aria-controls'));
  const open = menu.matches(':popover-open');
  if (event.key === 'Tab' || event.key === 'Escape') {
    if (open) {
      menu.hidePopover();
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (!open) {
    openSelect(trigger);
    return;
  }
  const options = [...menu.children];
  const current = options.findIndex((item) => item.id === trigger.getAttribute('aria-activedescendant'));
  if (event.key === 'Enter' || event.key === ' ') return chooseSelectOption(options[Math.max(0, current)]);
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  focusSelectOption(trigger, options[index]);
});
const panel = (heading, description, body) =>
  `<section class="panel"><h3>${heading}</h3>${description ? `<p class="muted">${description}</p>` : ''}${body}</section>`;
const empty = (title, description) =>
  `<div class="empty"><div class="symbol">◇</div><h3>${title}</h3><p>${description}</p></div>`;
const head = (title, description, action = '') =>
  `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="actions">${action}</div></div>`;
const saveBar = () =>
  '<div class="actions form-actions"><small id="save-state">配置保存到本机 SQLite</small><button class="primary" type="submit">保存配置</button></div>';
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
async function commit(message) {
  if (saving || !connected) return;
  saving = true;
  $('#app').inert = true;
  $('#modal').inert = true;
  const pending = copy(migrateMemories(data));
  try {
    const result = await request('', 'PUT', { revision: serverRevision, state: pending });
    acceptServer(result);
    dirty = false;
    render();
    toast(message === '已保存' ? '已保存到本机' : message + '，已保存到本机');
    return true;
  } catch (error) {
    let backup = false;
    try {
      localStorage.setItem('workforce.unsaved-backup', JSON.stringify(pending));
      backup = true;
    } catch {
      /* 存储失败时仍明确提示未保存。 */
    }
    try {
      acceptServer(await request(''));
    } catch {
      data = copy(confirmedData);
    }
    dirty = false;
    render();
    toast(
      `保存失败：${error.message}。${backup ? '未保存修改已留存浏览器备份 workforce.unsaved-backup。' : '未保存修改无法备份，请重新编辑。'}`,
    );
  } finally {
    saving = false;
    $('#app').inert = false;
    $('#modal').inert = false;
  }
}
function modal(title, body) {
  $('#modal-content').innerHTML =
    `<h2 id="modal-title">${esc(title)}</h2>${body}<p id="dialog-feedback" class="error" role="alert"></p>`;
  $('#modal').showModal();
}
function closeModal() {
  const secret = $('#ma-api-key');
  if (secret) secret.value = '';
  $('#modal').close();
}
function paintMaStatus(state) {
  const status = $('#ma-status');
  if (!status) return;
  const verified = state?.configured && state?.connected === true;
  status.className = `pill${verified ? ' green' : state?.configured ? ' amber' : ''}`;
  status.textContent = !state
    ? '方舟状态读取失败'
    : verified
      ? '方舟服务已连接'
      : state.configured
        ? '方舟已配置 · 待验证'
        : '方舟未配置';
  status.title = state?.message || '打开方舟配置查看详情';
}
async function refreshMaStatus() {
  try {
    paintMaStatus(await request('/ma-config'));
  } catch {
    paintMaStatus(null);
  }
}
async function openMaConfig() {
  try {
    const state = await request('/ma-config');
    paintMaStatus(state);
    modal(
      '方舟配置',
      `<p>${state.configured ? `已配置 · ${esc(state.source)}` : '尚未配置可用的 API Key'}</p>
      <p class="muted">用于数字员工调用方舟 MA。密钥仅保存到本机后端，不回显、不写入浏览器存储。页面配置优先于环境变量。</p>
      <form id="ma-config-form" autocomplete="off"><label for="ma-api-key">方舟 API Key</label>
      <input id="ma-api-key" type="password" name="apiKey" autocomplete="new-password" maxlength="4096" required placeholder="${state.configured ? '输入新密钥以替换；留空不修改' : '输入具备 MA 权限的 API Key'}" />
      <p class="muted">${esc(state.message)} 已运行的 Channel 更换密钥后需重启本机服务；待接入员工可直接继续接入。</p>
      <div class="actions form-actions">${button('取消', 'close')}<button class="primary" type="submit">保存配置</button></div></form>`,
    );
  } catch (error) {
    toast(error.message);
  }
}
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'ma-config-form') return;
  event.preventDefault();
  const form = event.target;
  const keyInput = form.elements.apiKey;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  $('#ma-status').textContent = '正在保存方舟配置…';
  $('#ma-status').className = 'pill';
  try {
    const state = await request('/ma-config', 'PUT', { apiKey: keyInput.value });
    paintMaStatus(state);
    keyInput.value = '';
    closeModal();
    toast('方舟 API Key 已保存，可继续员工的飞书接入');
  } catch (error) {
    keyInput.value = '';
    toast(error.message);
    void refreshMaStatus();
  } finally {
    submit.disabled = false;
  }
});
let feishuPoll;
let feishuDialogId;
async function openFeishu(id, begin = false, confirmedNotCreated = false, upgrade = false) {
  clearTimeout(feishuPoll);
  feishuDialogId = id;
  modal(
    '接入飞书',
    '<div id="feishu-progress">正在读取接入状态…</div><div class="actions form-actions">' +
      button('关闭', 'close') +
      '</div>',
  );
  try {
    const state = await request(
      `/employees/${encodeURIComponent(id)}/feishu${upgrade ? '/upgrade' : ''}`,
      begin ? 'POST' : 'GET',
      begin ? { confirmedNotCreated } : undefined,
    );
    paintFeishu(id, state);
  } catch (error) {
    if ($('#feishu-progress')) {
      try {
        paintFeishu(id, await request(`/employees/${encodeURIComponent(id)}/feishu`));
      } catch {
        $('#feishu-progress').textContent = error.message;
      }
    }
  }
}
function paintFeishu(id, state) {
  if (!$('#modal').open || feishuDialogId !== id || !$('#feishu-progress')) return;
  $('#feishu-progress').innerHTML = `<p role="status">${esc(state.message || state.status)}</p>
    ${state.status === 'awaiting_permissions' ? button('补齐现有应用权限', 'upgrade-feishu', id, true) : ''}
    ${state.appId && ['stopped', 'awaiting_ma', 'error'].includes(state.status) ? button('继续接入', 'resume-feishu', id, true) : ''}
    ${!state.appId && ['error', 'interrupted'].includes(state.status) ? `<p>若已创建应用，请保留现有应用并联系接入人员核对绑定。</p>${button('我确认尚未创建，重新生成二维码', 'retry-feishu', id, true)}` : ''}
    ${state.appId ? `<p>App ID：${esc(state.appId)}</p>` : ''}
    ${state.url ? `<canvas id="feishu-qr" aria-label="使用飞书扫描创建应用" role="img"></canvas><p><a href="${esc(state.url)}" target="_blank" rel="noopener noreferrer">${esc(state.url)}</a></p><small>请使用当前账号确认。链接失效时请先核查飞书应用创建结果。</small>` : ''}
    ${state.lastReceivedAt ? `<p>最近收到消息：${esc(new Date(state.lastReceivedAt).toLocaleString())}</p>` : ''}
    ${state.lastRepliedAt ? `<p>最近成功回复：${esc(new Date(state.lastRepliedAt).toLocaleString())}</p>` : ''}
    ${state.status === 'connected' ? '<p>先与机器人单聊测试。群聊中使用前，请将机器人加入群，并在「群聊」中关联此员工后 @机器人。</p>' : ''}`;
  if (state.qr) {
    const canvas = $('#feishu-qr'),
      scale = 4,
      size = state.qr.length;
    canvas.width = canvas.height = (size + 8) * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    state.qr.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
      }),
    );
  }
  if (
    !['error', 'interrupted', 'unbound', 'awaiting_ma', 'awaiting_permissions', 'stopped'].includes(
      state.status,
    )
  )
    feishuPoll = setTimeout(async () => {
      if (!$('#modal').open || !$('#feishu-progress') || feishuDialogId !== id) return;
      try {
        paintFeishu(id, await request(`/employees/${encodeURIComponent(id)}/feishu`));
      } catch {
        if ($('#feishu-progress')) $('#feishu-progress').textContent = '状态读取失败，请关闭后重新查看';
      }
    }, 2000);
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
  if (!connected) return;
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
    $('#content').innerHTML =
      module === 'tasks' ? runningTasks() : module === 'groups' ? groupsOverview() : overview(module);
  }
  applyFilters();
}
function groupsOverview() {
  return (
    head('群聊', '集中管理群聊及服务员工，按项目组织协作。', button('＋ 登记群聊', 'new-group', '', true)) +
    `<p class="demo-note">当前显示本地登记及项目关联的群聊。飞书尚未连接，无法同步实际触达范围；添加员工仅保存服务配置，不会执行真实入群。</p><div class="toolbar"><span class="muted">共 ${data.groups.length} 个群聊</span><input id="search" class="search" aria-label="搜索群聊" placeholder="搜索群聊、项目或员工…" value="${esc(search)}" /></div><div class="grid compact-cards">${data.groups.map((group) => `<article class="entity-card" data-search="${esc([group.name, group.chatId, projectName(group.projectId), ...group.employeeIds.map(employeeName)].join(' '))}"><div class="card-top"><span class="entity-icon">☏</span>${badge('入群状态未同步')}</div><h3>${esc(group.name)}</h3><p class="card-description">${esc(group.chatId)}</p><p class="muted">${group.projectId ? `<a href="#projects/${esc(group.projectId)}/groups">${esc(projectName(group.projectId))}</a>` : '未关联项目'}</p><p>服务员工 · ${esc(group.employeeIds.map(employeeName).join('、') || '尚未配置')}</p><div class="actions">${button('＋ 添加数字员工', 'assign-group', group.id, true)}${button('编辑群聊', 'manage-group', group.id)}</div></article>`).join('')}</div><div id="filter-empty" hidden>${empty('没有匹配群聊', '登记群聊或调整搜索关键词。')}</div>`
  );
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
      '保存员工环境配置；外部运行环境尚未连接。',
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
        if (feishu)
          return panel(
            '飞书',
            '用当前飞书账号确认创建应用，绑定后自动启动消息服务。',
            `<div class="actions">${button('创建应用并接入', 'connect-feishu', '', true)}${button('查看接入状态', 'view-feishu')}</div>`,
          );
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
    content = `<div class="section-toolbar"><p class="muted">保存当前配置快照，支持本地版本发布与切换。</p>${button('发布版本', 'publish', '', true)}</div><div class="version-stack">${[
      ...e.versions,
    ]
      .reverse()
      .map(
        (version) =>
          `<article class="panel version-card"><div><h3>v${version.number} ${version.id === e.activeVersion ? badge('当前版本', 'green') : ''}</h3><p class="muted">${esc(version.note)} · ${date(version.createdAt)}</p></div><div class="actions">${button('查看配置', 'view-version', version.id)}${version.id !== e.activeVersion ? button('切换到此版本', 'activate-version', version.id) : ''}</div></article>`,
      )
      .join('')}</div>${!e.versions.length ? empty('暂无版本', '完成员工配置后，发布第一个本地版本。') : ''}`;
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
      .map((entry) =>
        entry.id === selectedMemoryEntry
          ? `<div class="memory-file selected memory-file-inline"><span aria-hidden="true">▤</span><input id="memory-path-input" aria-label="条目路径（双击或按 F2 修改）" value="${esc(entry.filename)}" title="${esc(entry.path)} · 双击或按 F2 修改路径" readonly /></div>`
          : `<button type="button" class="memory-file" data-action="select-memory" data-id="${esc(entry.id)}" title="${esc(entry.path)}"><span aria-hidden="true">▤</span> ${esc(entry.filename)}</button>`,
      )
      .join('')
  );
}
function memoryDocument(entry) {
  if (!entry) return empty('暂无条目', '添加一个路径和文本内容，开始维护记忆。');
  return `<form id="memory-entry-form" data-kind="memory" data-id="${esc(entry.id)}"><div class="memory-document-head"><div class="memory-title-actions"><strong id="memory-document-path" class="memory-path">/${esc(entry.path)}</strong>${button('基础信息', 'memory-info', entry.id)}</div><div class="actions">${button('删除', 'delete-memory', entry.id)}${button('取消', 'cancel-memory')}<button class="primary" type="submit">保存</button></div></div>${['storeId', 'path', 'title', 'source'].map((name) => `<input type="hidden" name="${name}" value="${esc(entry[name])}" />`).join('')}<div class="memory-inline-editor"><div id="memory-line-numbers" aria-hidden="true">${entry.content
    .split('\n')
    .map((_, i) => i + 1)
    .join(
      '\n',
    )}</div><textarea aria-label="文本内容" name="content" class="memory-direct-text" spellcheck="false" wrap="off" maxlength="30000" required>${esc(entry.content)}</textarea></div><div class="memory-document-foot"><span id="save-state">点击内容直接编辑 · 双击左侧文件名修改路径</span><span>更新于 ${date(entry.updatedAt)}</span></div></form>`;
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
    content = `<div class="section-toolbar"><p class="muted">维护项目关联群聊，并指定服务员工。</p>${button('＋ 关联群聊', 'add-group', '', true)}</div><div class="grid compact-cards">${p.groups.map((group) => `<article class="entity-card"><span class="entity-icon">▦</span><h3>${esc(group.name)}</h3><p class="card-description">${esc(group.chatId)}</p><p class="muted">数字员工 · ${esc(group.employeeIds.map(employeeName).join('、') || '尚未配置')}</p><div class="actions">${button('＋ 添加数字员工', 'assign-group', group.id)}${button('编辑', 'edit-group', group.id)}${button('解除关联', 'remove-group', group.id)}</div></article>`).join('')}</div>${!p.groups.length ? empty('尚未关联群聊', '将群聊关联到项目，组织项目协作。') : ''}`;
  if (section === 'members')
    content = `<div class="section-toolbar"><p class="muted">管理谁可以查看、改写记忆，以及维护成员。</p>${button('＋ 添加成员', 'add-member', '', true)}</div><div class="permission-legend"><span><b>查看</b> 只读项目记忆</span><span><b>改写</b> 可新增、编辑和删除记忆</span><span><b>管理</b> 改写记忆及管理成员</span></div><p class="demo-note">当前为本机管理员模式；成员权限已保存，多用户身份鉴权尚未接入。</p><div class="grid compact-cards">${p.members.map((member) => `<article class="entity-card"><div class="card-top"><span class="member-avatar">${esc(member.name.slice(0, 1))}</span>${badge({ read: '查看', write: '改写', manage: '管理' }[member.permission])}</div><h3>${esc(member.name)}</h3><p class="card-description">${esc(member.account)}</p><div class="actions">${button('修改权限', 'edit-member', member.id)}${button('移除', 'remove-member', member.id)}</div></article>`).join('')}</div>`;
  return (
    '<a class="back" href="#projects">← 项目</a>' +
    head(p.name, p.description, button('编辑项目', 'edit-project')) +
    `<div class="employee-summary"><span>项目记忆<b>${p.memories.length}</b></span><span>群聊<b>${p.groups.length}</b></span><span>成员<b>${p.members.length}</b></span></div>` +
    tabs('projects', p.id, projectTabs, section) +
    content
  );
}
function runningTasks() {
  const history = route().id === 'history';
  const active = activeTasks(data.tasks);
  const ended = data.tasks
    .filter((task) => ['completed', 'cancelled', 'failed'].includes(task.status))
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))
    .slice(0, 20);
  const rows = history ? ended : active;
  const statuses = history
    ? [
        ['completed', '已完成'],
        ['failed', '失败'],
        ['cancelled', '已取消'],
      ]
    : [
        ['running', '执行中'],
        ['queued', '等待中'],
      ];
  const labels = Object.fromEntries(statuses);
  return (
    head(
      '任务',
      '本地执行上下文快照，验证员工配置与项目记忆的组装。',
      button('＋ 发起本地任务', 'new-task', '', true),
    ) +
    `<nav class="detail-tabs task-tabs" aria-label="任务分类"><a href="#tasks" class="${history ? '' : 'active'}" ${history ? '' : 'aria-current="page"'}>运行中 <span class="task-tab-count">${active.length}</span></a><a href="#tasks/history" class="${history ? 'active' : ''}" ${history ? 'aria-current="page"' : ''}>最近结束 <span class="task-tab-count">${ended.length}</span></a></nav><p class="muted">${history ? '显示最近结束的 20 项任务' : `${active.filter((r) => r.status === 'running').length} 项执行中 · ${active.filter((r) => r.status === 'queued').length} 项等待中`} · 每 2 秒更新</p><div class="observation-filters"><input id="search" class="search" aria-label="搜索任务" placeholder="搜索任务、员工或项目…" value="${esc(search)}" />${select(
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
      ...statuses,
    ])}</div><div class="grid compact-cards">${rows.map((row) => `<article class="entity-card" data-search="${esc(row.name + employeeName(row.employeeId) + projectName(row.projectId))}" data-status="${esc(row.status)}" data-type="${esc(row.type)}"><div class="card-top"><span class="muted">本地上下文快照</span>${badge(labels[row.status], ['running', 'completed'].includes(row.status) ? 'green' : row.status === 'failed' ? 'red' : '')}</div><h3>${esc(row.name)}</h3><p class="card-description">${esc(employeeName(row.employeeId))}<br/>${esc(projectName(row.projectId))}</p><p>${esc(row.progress)}</p><div class="card-footer">${history ? `<span>${row.finishedAt ? esc(date(row.finishedAt)) : '已结束'}</span>` : button('取消任务', 'cancel-task', row.id)}${button(history ? '查看结果' : '查看进度', 'view-task', row.id)}</div></article>`).join('')}</div><div id="filter-empty" hidden>${empty(rows.length ? '没有匹配任务' : history ? '暂无最近结束的任务' : '暂无运行中的任务', rows.length ? '调整关键词或筛选条件。' : history ? '任务结束后会显示在这里。' : '点击发起本地任务开始验收。')}</div>`
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
  if (kind === 'task') {
    title = '发起本地任务';
    fields =
      '<p class="muted">生成上下文快照，不调用 MA，不发送群消息。</p>' +
      field('任务名称', 'name', '上下文验收', '', true) +
      select(
        '数字员工',
        'employeeId',
        '',
        data.employees.filter((employee) => employee.enabled).map((employee) => [employee.id, employee.name]),
      ) +
      select('关联项目', 'projectId', '', [
        ['', '无项目'],
        ...data.projects.map((project) => [project.id, project.name]),
      ]) +
      `<input type="hidden" name="requestId" value="${uid()}" />`;
  }
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
  if (kind === 'memory-info') {
    title = '条目基础信息';
    fields =
      select(
        '所属记忆库',
        'storeId',
        item.storeId,
        owner.memoryStores.map((store) => [store.id, store.name]),
      ) +
      field('标题（可选）', 'title', item.title) +
      field('来源说明', 'source', item.source);
  }
  if (kind === 'group') {
    title = item.id ? '编辑群聊' : '关联群聊';
    fields =
      field('群聊名称', 'name', item.name, '填写群聊名称', true) +
      field('群聊 ID', 'chatId', item.chatId, 'oc_…', true) +
      select('关联项目', 'projectId', item.projectId || owner?.id || '', [
        ['', '暂不关联项目'],
        ...data.projects.map((project) => [project.id, project.name]),
      ]);
  }
  if (kind === 'group-employees') {
    title = '添加数字员工 · ' + item.name;
    fields =
      '<p class="muted">勾选为此群服务的数字员工，取消勾选可解除服务配置。真实入群将在飞书连接后执行。</p>' +
      data.employees
        .map(
          (employee) =>
            `<label class="checkbox-label"><input type="checkbox" name="employeeIds" value="${esc(employee.id)}" ${item.employeeIds.includes(employee.id) ? 'checked' : ''} ${!employee.enabled && !item.employeeIds.includes(employee.id) ? 'disabled' : ''} />${esc(employee.name)}${employee.enabled ? '' : '（已停用）'}</label>`,
        )
        .join('');
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
    title = '发布本地版本';
    fields =
      '<p class="muted">将当前已保存配置生成本地版本快照，不会发布到 MA。</p>' +
      field('版本说明', 'note', '', '概述本次调整', true);
  }
  modal(
    title,
    `<form id="dialog-form" data-kind="${kind}" data-id="${esc(item.id || '')}" data-owner="${esc(owner?.id || '')}">${fields}<div class="actions form-actions">${button('取消', 'close')}<button class="primary" type="submit">${kind === 'publish' ? '确认发布' : kind === 'memory-info' ? '应用' : '保存'}</button></div><p class="demo-note">${kind === 'memory-info' ? '应用后，点击内容区顶部的保存，与正文和路径一起保存。' : '保存到本机工作台'}</p></form>`,
  );
}
function confirmAction(title, text, action, id) {
  modal(
    title,
    `<p>${esc(text)}</p><div class="actions form-actions">${button('取消', 'close')}${button('确认', action, id, true)}</div>`,
  );
}
document.addEventListener('click', async (event) => {
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
  if (action === 'reconnect') return connectWorkspace();
  if (action === 'ma-config') return openMaConfig();
  if (action === 'retry-feishu') return openFeishu(id, true, true);
  if (action === 'upgrade-feishu') return openFeishu(id, true, false, true);
  if (action === 'resume-feishu') return openFeishu(id, true);
  if (action === 'connect-feishu') return openFeishu(owner.id, true);
  if (action === 'view-feishu') return openFeishu(owner.id);
  if (action === 'new-task') return editDialog('task');
  if (action === 'new-group') return editDialog('group');
  if (action === 'manage-group' || action === 'assign-group')
    return editDialog(
      action === 'manage-group' ? 'group' : 'group-employees',
      data.groups.find((group) => group.id === id),
    );
  if (action === 'cancel-task') {
    try {
      await request(`/tasks/${encodeURIComponent(id)}/cancel`, 'POST', {});
      await refreshTasks();
      toast('任务已取消');
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (action === 'close') return closeModal();
  if (action === 'new-employee') return editDialog('employee');
  if (action === 'new-project') return editDialog('project');
  if (action === 'edit-project') return editDialog('project', owner);
  if (action === 'view-task') {
    const row = data.tasks.find((r) => r.id === id);
    return modal(
      row.name,
      `<p class="muted">${esc(employeeName(row.employeeId))} · ${esc(projectName(row.projectId))}</p>${badge({ running: '执行中', queued: '等待中', completed: '已完成', cancelled: '已取消', failed: '失败' }[row.status])}<p>${esc(row.detail)}</p><ol class="timeline">${row.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>${row.result ? `<h3>执行结果</h3><pre class="task-result">${esc(row.result)}</pre>` : '<p class="muted">关闭详情后列表自动更新。</p>'}`,
    );
  }
  if (!owner) return;
  if (action === 'memory-info') {
    const values = Object.fromEntries(new FormData($('#memory-entry-form')));
    return editDialog('memory-info', { id, ...values });
  }
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
    return confirmAction('确认移除', '确认从本机工作台移除此记录？', 'confirm-' + action, id);
  if (action.startsWith('confirm-remove-') || action === 'confirm-delete-memory') {
    if (action === 'confirm-remove-group') {
      data.groups.find((group) => group.id === id).projectId = '';
      syncProjectGroups(data);
      closeModal();
      return commit('项目关联已解除，群聊仍保留在群聊列表');
    }
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
document.addEventListener('submit', async (event) => {
  if (event.target.id === 'ma-config-form') return;
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
      if (values.doubaoEnabled === 'true' && !values.agentId.trim()) return toast('启用渠道前请填写对应标识');
      owner.channels = {
        feishu: owner.channels.feishu,
        doubao: { enabled: values.doubaoEnabled === 'true', agentId: values.agentId.trim() },
      };
    }
    owner.updatedAt = new Date().toISOString();
    return commit('配置已保存');
  }
  if (form.id !== 'dialog-form' && form.id !== 'memory-entry-form') return;
  const kind = form.dataset.kind,
    id = form.dataset.id;
  if (kind === 'task') {
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await request('/tasks', 'POST', values);
      closeModal();
      await refreshTasks();
      toast('任务已提交到本机队列');
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
    return;
  }
  if (kind === 'memory-info') {
    for (const [name, value] of Object.entries(values))
      $('#memory-entry-form').elements[name].value = value.trim();
    dirty = true;
    $('#save-state').textContent = '有未保存的修改';
    closeModal();
    return;
  }
  for (const key of Object.keys(values)) if (key !== 'content') values[key] = values[key].trim();
  if (kind === 'employee') {
    if (!values.name) return toast('请填写名称');
    const item = initialEmployee(uid(), values.name, values.description);
    data.employees.push(item);
    closeModal();
    if (await commit('员工已创建')) {
      history.pushState(null, '', `#employees/${item.id}/channels`);
      render();
      await openFeishu(item.id, true);
    }
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
        members: [{ id: uid(), name: '本机管理员', account: 'local-admin', permission: 'manage' }],
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
    if (!values.name || !values.chatId) return toast('请补全群聊信息');
    if (data.groups.some((group) => group.chatId === values.chatId && group.id !== id))
      return toast('此群聊已登记，请在群聊列表中编辑');
    if (id)
      Object.assign(
        data.groups.find((group) => group.id === id),
        values,
      );
    else data.groups.push({ id: uid(), ...values, employeeIds: [], source: 'manual' });
    syncProjectGroups(data);
  }
  if (kind === 'group-employees') {
    data.groups.find((group) => group.id === id).employeeIds = new FormData(form).getAll('employeeIds');
    syncProjectGroups(data);
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
  commit(kind === 'publish' ? '本地版本已发布' : '已保存');
});
function startPathRename() {
  const input = $('#memory-path-input');
  if (!input) return;
  input.readOnly = false;
  input.value = $('#memory-entry-form').elements.path.value;
  input.focus();
  input.select();
}
document.addEventListener('dblclick', (event) => {
  if (event.target.id === 'memory-path-input') startPathRename();
});
document.addEventListener('keydown', (event) => {
  if (event.target.id !== 'memory-path-input') return;
  if (event.key === 'F2') {
    event.preventDefault();
    startPathRename();
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    $('#memory-entry-form').requestSubmit();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    const entry = context().owner.memories.find((item) => item.id === selectedMemoryEntry);
    $('#memory-entry-form').elements.path.value = entry.path;
    event.target.value = entry.path.split('/').at(-1);
    event.target.readOnly = true;
    $('#memory-document-path').textContent = '/' + entry.path;
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'memory-path-input') {
    $('#memory-entry-form').elements.path.value = event.target.value;
    $('#memory-document-path').textContent = '/' + event.target.value;
    dirty = true;
    $('#save-state').textContent = '有未保存的修改';
    return;
  }
  if (event.target.matches('.memory-direct-text')) {
    $('#memory-line-numbers').textContent = event.target.value
      .split('\n')
      .map((_, i) => i + 1)
      .join('\n');
  }
  if (event.target.id === 'search') {
    search = event.target.value;
    applyFilters();
  } else if (event.target.closest('#employee-form, #memory-entry-form')) {
    dirty = true;
    if ($('#save-state')) $('#save-state').textContent = '有未保存的修改';
  }
});
document.addEventListener(
  'scroll',
  (event) => {
    if (event.target.matches?.('.memory-direct-text'))
      $('#memory-line-numbers').scrollTop = event.target.scrollTop;
  },
  true,
);
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
let pollingTasks = false;
let taskRenderPending = false;
async function refreshTasks() {
  if (pollingTasks || !connected) return;
  pollingTasks = true;
  try {
    const result = await request('/tasks');
    const changed = JSON.stringify(data.tasks) !== JSON.stringify(result.tasks);
    taskRenderPending ||= changed;
    data.tasks = result.tasks;
    if (confirmedData) confirmedData.tasks = copy(result.tasks);
    if (
      taskRenderPending &&
      route().module === 'tasks' &&
      !$('#modal').open &&
      !document.querySelector('.select-menu:popover-open') &&
      !document.activeElement?.matches('input, [role="combobox"]')
    ) {
      render();
      taskRenderPending = false;
    }
  } finally {
    pollingTasks = false;
  }
}
setInterval(() => {
  if (connected && !saving && route().module === 'tasks')
    refreshTasks().catch(() => {
      $('#workspace-status').textContent = '任务更新失败，请检查本机服务';
    });
}, 2000);
window.addEventListener('focus', () => {
  if (connected && !$('#ma-config-form')) void refreshMaStatus();
});
connectWorkspace();
