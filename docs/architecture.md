# imboss 系统架构与代码规范指南

本文档系统性梳理了 imboss 的工程架构、分层职责、数据流转机制及编码纪律，为后续功能修复、缺陷排查与新特性开发提供明确遵循的标准规范。

---

## 1. 架构总览与技术栈

imboss 是一款桌面级「一人公司」AI 协同工作台。采用 **Electron 三进程模型 + 本地优先（Local-First）SQLite 存储 + Pi Agent 隔离运行** 的整体架构。

```
┌────────────────────────────────────────────────────────┐
│                      Renderer 进程                      │
│        React 19 + TypeScript + Valtio + CSS Tokens     │
│                 (UI 视图、响应式状态、交互事件)               │
└───────────────────────────┬────────────────────────────┘
                            │  window.imb (IPC 契约)
┌───────────────────────────▼────────────────────────────┐
│                      Preload 桥接层                     │
│            contextBridge 暴露严格受控的 API               │
└───────────────────────────┬────────────────────────────┘
                            │  ipcRenderer ↔ ipcMain
┌───────────────────────────▼────────────────────────────┐
│                       Main 主进程                       │
│    Node.js 22 + better-sqlite3 (WAL) + Pi Coding Agent │
│         (生命周期管理、数据库读写、Agent 推理与调度)         │
└────────────────────────────────────────────────────────┘
                            ▲
                            │ 共享类型、常量与国际化
┌───────────────────────────┴────────────────────────────┐
│                    @shared (共享契约)                   │
└────────────────────────────────────────────────────────┘
```

### 核心技术栈
- **桌面容器**：Electron 44
- **构建工具**：`@desirecore/electron-vite` (Vite 7 + Rollup)
- **前端视图**：React 19 + TypeScript 7
- **前端状态管理**：Valtio 2 (`proxy` + `useSnapshot`)
- **数据持久化**：`better-sqlite3` (WAL 模式，存储在 `~/.imboss/db/imboss.db`)
- **智能体引擎**：`@earendil-works/pi-coding-agent` (运行在 `~/.imboss/agent`)
- **样式体系**：原生 CSS + Design Tokens（无 Tailwind / CSS-in-JS，严格采用 `.imb-*` 与 `var(--imb-*)`）

---

## 2. 目录划分与模块职责清单（一句话定义原则）

遵循「一个文件/目录必须能用一句话清晰定义其核心职责」的纪律。

```
src/
├── main/             # 主进程：独占本地系统与数据库访问，托管 Agent 与系统服务
│   ├── index.ts      # 主进程入口：应用生命周期、单实例锁与窗口创建
│   ├── data-dir.ts   # 数据路径管理：解析与维护 ~/.imboss 根目录及各子目录路径
│   ├── locale.ts     # 系统语言初始化：根据设置或 OS 语言加载主进程本地化字符串
│   ├── theme.ts      # 主题同步：同步系统原生暗黑/明亮外观状态
│   ├── window-state.ts# 窗口持久化：记录和恢复窗口宽高与坐标
│   ├── notifications.ts# 原生通知调度：分发系统通知、dock 角标与提示音
│   ├── cron.ts       # 应用定时器：基于 croner 调度员工定时任务
│   ├── mini-apps.ts  # 微应用管理：本地 Mini-App 的进程启动、端口探测与静态代理
│   ├── mcp-store.ts  # MCP 存储配置：本地 MCP 服务清单与环境变量存储
│   ├── db/           # SQLite 数据持久化层（见 2.1）
│   ├── agent/        # Agent 运行时与执行引擎（见 2.2）
│   ├── ipc/          # IPC 通道处理函数映射层（见 2.3）
│   └── integrations/ # 外部 IM 渠道长连接桥接器（微信/QQ/Telegram）
├── preload/          # 预加载层：在上下文隔离下向渲染进程注入 window.imb API
│   ├── index.ts      # 导出 contextBridge API 映射
│   └── types.d.ts    # 全局类型注入声明（declare const imb: IMB）
├── shared/           # 跨端共享契约层：三端共用的类型定义、常量与国际化
│   ├── constants/    # 共享常量（系统保留 ID、Prompt 模板、服务商等）
│   ├── types/        # 领域数据结构与通信载荷的 TypeScript 接口定义
│   ├── l10n.ts       # 简易字符串模版翻译函数 t() 与语言环境注册
│   └── translations/ # 多语言映射文件（zhCN.json 等）
└── renderer/         # 渲染进程：纯 UI 与交互呈现
    ├── main.tsx      # React 应用挂载入口
    ├── App.tsx       # 顶层布局容器与活动模块分发切换器
    ├── app-store.ts  # 全局单例响应式状态机（Valtio proxy），集中管理 UI 交互状态与缓存
    ├── styles/       # CSS 设计令牌 (tokens.css) 与全局基线样式 (base.css)
    ├── hooks/        # 平台专用 React 自定义钩子（虚拟列表、点击穿透、输入法合成等）
    └── components/   # 组件库与功能模块视图（见 2.4）
```

### 2.1 `src/main/db/` 数据库层职责
- `index.ts`：负责初始化 SQLite 单例连接并启用 WAL 模式及外键约束。
- `migrations.ts`：顺序执行数据表升迁脚本（严格基于 `user_version` 单调递增）。
- `chats.ts`、`messages.ts`、`employees.ts`、`sessions.ts`、`settings.ts`、`cron.ts`、`integrations.ts`：各领域实体的底层 CRUD，保证纯粹的数据增删改查逻辑，不掺杂外部通信副作用。
- `text-search.ts`：基于 FTS5 trigram 虚拟表的消息全文检索实现。

### 2.2 `src/main/agent/` Agent 运行时职责
- `session.ts`：Pi SDK `AgentSession` 实例的配置构建、环境隔离、上下文缓存与重用决策。
- `session-queue.ts`：保证同一个 `(employee, chat)` 的任务严格串行执行的执行队列。
- `builtin-tools.ts`：注入给大模型的 `imb_*` 系统级工具（发消息、汇报进度、提问、建群等）。
- `builtin-skills.ts`：将内置助手技能物理写出至应用沙箱以供加载。
- `model-runtime.ts`：多模型服务商运行时适配与可用模型列表拉取。
- `mcp.ts`：将 MCP 服务配置转换为 Pi SDK 所需的上下文扩展。
- `tools.ts`：注入受控的 shell/bash/pwsh 命令行执行工具。

### 2.3 `src/main/ipc/` IPC 处理层职责
- 遵循领域划分，每一类业务实体单独对应一个文件（如 `chat.ts`、`message.ts`、`employee.ts`、`provider.ts`）。
- 核心职责：解包 IPC 参数 -> 权限与安全检查 -> 调用 `db/` 或 `agent/` 逻辑 -> 返回结构化数据或向 WebContents 广播事件。
- 入口集中在 `src/main/ipc/index.ts` 注册。

### 2.4 `src/renderer/` 视图与组件职责
- `components/modules/`：业务功能页面，每一个模块独立成文件夹：
  - `chat/`：仿微信沉浸式消息流、输入框、气泡渲染、卡片（Ask 卡片、Progress 卡片、Chat 链接卡片）。
  - `employees/`：AI 员工档案、招聘向导、系统提示词与 Cron 任务编排。
  - `providers/`：大模型供应商的复用组件（新增弹窗、配置字段、详情面板）；供应商列表本身已并入 `settings/settings-providers/`。
  - `mcp/`：MCP 服务的注册、连接测试与工具探测。
  - `skills/`：基于 `SKILL.md` 的本地技能管理。
  - `miniapp/`：保持持久化挂载的本地微应用展示容器。
  - `settings/`：通用偏好、外观颜色、资源与集成配置；含模型供应商管理（`settings-providers/`，内嵌列表＋详情）。
- `components/[atomic-ui]/`：原子和基础复合组件（`button`, `input`, `modal`, `avatar`, `virtual-list` 等）。每个组件自带 `index.tsx` 和 `index.css`。

---

## 3. 核心数据流与协同机制

### 3.1 渲染进程与主进程的双向通信

1. **请求-响应模式 (Invoke / Handle)**：
   - 渲染层：`await imb.chat.get(id)`
   - Preload：`ipcRenderer.invoke("chat:get", id)`
   - Main：`ipcMain.handle("chat:get", (_e, id) => ...)`
   - 命名规范：严格使用 `domain:action`（冒号隔开，小驼峰或小写动词）。

2. **主进程推送事件 (Broadcast Event)**：
   - Main：`mainWindow.webContents.send("messages:received", message)`
   - Preload：提供订阅闭包 `onMessageReceived: (cb) => on("messages:received", cb)`
   - 渲染层：在 `app-store.ts` 初始化时全局监听，并就地更新 Valtio 状态；React 组件通过快照感知并触发最小局部渲染。

### 3.2 消息驱动与 Agent 闭环逻辑

```
1. 用户在聊天框发送消息 ──> imb.messages.send(...)
                             │
                             ▼
2. Main: 插入 messages 表，广播 "messages:received" 事件
                             │
                             ▼
3. Main: wakeAgent(employeeId, chatId) 入队
                             │
                             ▼
4. session-queue 调度 ──> session.ts 准备 Pi 实例
                             │
                             ▼
5. 大模型执行推理 ──> 触发内置工具 (如 imb_progress, imb_send_message)
                             │
                             ▼
6. 内置工具写库 ──> 再次向渲染进程广播事件 ──> 界面实时展示进度条/回复内容
```

---

## 4. 代码规范与架构约束

在新增逻辑、修复缺陷或重构模块时，必须严格遵守以下规范：

### 4.1 职责纪律与文件组织
1. **单一清晰职责**：
   - 每个文件必须能用一句话清晰定义其核心职责。
   - 新增逻辑前自检：原有职责能否自然涵盖？无法涵盖时按业务语义立即拆分，禁止硬塞。
2. **严禁机械切分**：
   - 拆分必须按领域职责边界进行，严禁按代码行数机械分割，绝对禁止出现 `utils2.ts`、`part2.ts`、`helpers-extra.ts` 等模糊文件。
3. **聚合优先，避免过度碎片化**：
   - 相关逻辑默认内聚在最小集合的文件中。禁止为了形式上的短小将一个高内聚的功能拆成几十个微小文件。
4. **500 行兜底红线**：
   - 500 行是强行自检的红线。文件达到或接近 500 行时，必须复核职责是否蔓延。
5. **尊重历史上下文**：
   - 老模块除非直接受本次修改影响，否则不做无意义的主动翻新。修改时保持已有代码的设计哲学与既有命名惯例。

### 4.2 前端代码与 UI 纪律
1. **状态驱动原则**：
   - 优先通过 `app-store.ts` 的 Valtio proxy 组织跨组件业务状态。
   - 临时交互状态（如弹窗开关、悬浮提示、输入暂存）保留在组件本地 `useState`。
2. **CSS 规范**：
   - 所有 CSS 类名强制带有 `.imb-` 前缀（如 `.imb-btn`, `.imb-chat-bubble`）。
   - 严禁硬编码颜色、圆角、字号。一律使用 `var(--imb-*)`（定义于 `tokens.css`）。
   - 组件样式文件与组件代码平级放置：`index.tsx` 对应 `index.css`。
3. **无障碍与国际化**：
   - 文案禁止裸写中文。英文作为基准 Key，中文在 `src/shared/translations/zhCN.json` 配置，通过 `t("Key String")` 获取。

### 4.3 后端与数据层纪律
1. **数据库操作安全**：
   - 只能在 `src/main/db/` 内部直接调用 `better-sqlite3` 实例。
   - 禁止在 IPC handler 或 Agent 中直接书写原生 SQL。
   - 表结构变更必须在 `src/main/db/migrations.ts` 追加新的升迁事务函数，绝不可篡改历史已发布的迁移步骤。
2. **Agent 隔离性**：
   - 永远不要污染系统级环境（如用户本机的 `~/.pi`），必须使用 `getAgentRoot()`（`~/.imboss`）。

---

## 5. 功能修复与开发标准化步骤（Checklist）

修复或改造功能时，按照以下标准工序推进：

- [ ] **1. 契约自检（Shared 层）**
  - 是否需要修改通信数据结构？若需要，先在 `src/shared/types/` 中更新类型定义。
  - 是否涉及常量？在 `src/shared/constants/` 声明。
- [ ] **2. 持久化与逻辑层（Main 核心层）**
  - 数据模型变更？在 `src/main/db/migrations.ts` 追加 Migration，并在对应 `db/*.ts` 封装安全读写方法。
  - Agent 交互变更？在 `src/main/agent/` 检查 prompt、tool 签名或环境配置。
- [ ] **3. IPC 管道贯通**
  - 在 `src/main/ipc/*.ts` 实现/修复对应的 IPC handler。
  - 在 `src/preload/index.ts` 中映射方法到 `api` 对象，并在 `preload/types.d.ts` 保持类型同步。
- [ ] **4. 渲染层视图与状态同步**
  - 在 `src/renderer/app-store.ts` 补齐对应的状态与调用动作。
  - 在对应的 `components/modules/` 页面中完成视图绑定、样式编写（`.imb-*`）与多语言匹配（`t()`）。
- [ ] **5. 编译自检与职责复核**
  - 运行 `pnpm run typecheck` 保证主进程与渲染进程类型检查 100% 通过。
  - 自检修改文件的职责边界，确认没有制造垃圾文件或过度蔓延。
