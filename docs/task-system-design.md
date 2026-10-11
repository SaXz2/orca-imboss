# 任务系统设计参考：Muse 的卡片化 + GitHub 的协作模型

本文是 imboss 任务系统改造的设计底稿。两部分来源：一是对 Meta 的 Muse（macOS 应用）拆包后得到的实证设计语言；二是 GitHub 的 issue / PR / discussion 协作原语。最后落到 imboss 现有的 `Task` / `BoardCard` 上，给出分期方案。

---

## 一、Muse 的卡片化设计（实证）

### 1.1 它是什么

- `Muse-7.0.dmg` 解包后：`Muse.app` 的 `Info.plist` 为 `CFBundleIdentifier = com.meta.endo`，`FacebookAppID`、`SUFeedURL` 指向 `facebook.com/endo/release/appcast.xml`，吉祥物 Hatch。是 Meta 的个人 agent 产品。
- 外壳是原生 macOS（`MacOS/Muse` 51 MB Mach-O，Frameworks 只有 Sparkle 自动更新），但**主界面是一套内嵌的 React web bundle**：`Contents/Resources/hatch/index.html`，单文件约 44 MB（全量内联）。另外 `markdown-editor.html` 是独立的 React 编辑器，`muse-brand-loader-middle-out.json` 是 Lottie 加载动画。
- 因此它的 UI 设计可以从源码层面读出来，不需要反编译二进制。

### 1.2 核心判断：**卡片即一切**

bundle 里的卡片组件是完整的分类体系，几乎每一种信息都被建模成一种卡：

| 类别 | 卡片 |
| --- | --- |
| 决策 | `HatchApprovalCardDeck`、`HatchInlineApprovalCard`（+ Error/Lazy 变体） |
| 产物 | `HatchLibraryCard`、`HatchArtifactIcon`、`artifact_card` |
| 会话 | `HatchConversationCard`、`HatchChatNodeCard`、`HatchMessageShareCard` |
| 动态 | `HatchFeedUnitCard`、`HatchIdeaCard`、`exploreIdeaCardQuery` |
| 文件 | `HatchSandboxFileCard` |
| 任务 | `HatchBrowserTaskCard` |
| 通用 | `HatchKeyValueCard`、`HatchTextWithButtonCard`、`HatchLetterCard`、`HatchSpaceProposalCard` |
| 悬浮预览 | `HatchHoverCard` / `HatchResponsiveHoverCard`、`CitationHoverCard`、`AnnotationCard` |
| 场景 | `InvitationLinkCard`、`InviteCodeScratchCard`、`HatchQrCodeCard`、`PodcastEpisodeCard`、`SettingsCard` |

三个值得直接借走的机制：

1. **`ApprovalCardDeck`（批准卡叠）**：把待决策的批准卡按批次（`batchKey`，区分 `isExclusive` 的单卡与共享内联批准）叠成一叠，一次处理一批，支持键盘决策与焦点归属。这是"待办决策"的理想形态。
2. **Hover 预览卡**：卡片在列表里就能被悬停展开细节，不必进入详情页。
3. **卡内自带 icon + key-value + 动作条**：`HatchArtifactIcon`、`HatchKeyValueCard`、`HatchTextWithButtonCard` 是可复用的卡内积木。

### 1.3 设计 token：语义化命名 + 数字刻度

```css
:root {
  --text-primary: var(--ai-gray-1100);
  --text-secondary: var(--ai-gray-a650);
  --text-tertiary: var(--ai-gray-a400);
  --text-quaternary: var(--ai-gray-a300);
  --icon-primary: var(--ai-gray-1100);  /* icon 与 text 成对 */
  --fill-secondary-elevated: ...;        /* 卡片底色 */
  --fill-divider: ...;
  --text-destructive: var(--red-650);
  --text-success: var(--green-650);
  --text-warning: var(--orange-650);
  --accent: var(--blue-650);             /* 可被主题覆盖 */
}
@supports (color: color-mix(in lab, red, red)) {
  :root { --hatch-primary-action-background: color-mix(in srgb, var(--accent) 90%, var(--black)); }
}
```

要点：
- 颜色只按**语义**命名（text/icon/fill/bg + 层级 primary→quaternary），不按色值命名；换主题只改一层映射。
- `text-*` 与 `icon-*` 成对出现，保证图标和文字永远同步层级。
- `--accent` 默认 `blue-650`，且用 `color-mix` 直接派生出"按下/强调"的加深色，而不是再定义一堆色号。
- 间距圆角用数字刻度：`gap-3`、`p-4`、`px-4 py-5`、`rounded-12`、`rounded-16`、`h-14`。

### 1.4 协作词汇：一整套社交/GitHub 原语

`zh-Hans.lproj/Localizable.strings` 里已有成体系的词：

- 反馈：赞、赞了、取消赞
- 收藏：收藏、已收藏、取消收藏、送星星
- 关注：关注、已关注、订阅、已订阅、随时更新提醒、动态更新
- 讨论：帖子、发帖、评论、回复、参考、分享、转发、复制链接、详情
- 动态流：活动、正在加载活动…
- 权限：权限卡、正在加载权限卡、操作批准卡、始终允许、每次询问、需要权限、被屏蔽的应用、被阻止访问的文件夹

其中"送星星""参考""关注/订阅""评论/回复"正是 GitHub 的 star / reference / watch / comment。

### 1.5 权限与决策是一等公民

- 每个敏感能力都有卡片：系统权限卡、操作批准卡、购物结算批准卡、外发媒体批准卡。
- 决策粒度分级：`每次询问` / `始终允许` / `始终拒绝`，且"更改设置会清除已保存的操作批准"。
- 决策会作为事件被记录：`chat_inline_approval_card_impression`、`browser_checkout_approval_impression`、`status_pending_approvals_impression`、`status_actioned_approvals_impression`。**卡片本身就是分析单元。**

---

## 二、GitHub 的协作原语（要点提炼）

| 原语 | 本质 | 关键机制 |
| --- | --- | --- |
| Issue | 一条可讨论线程 | opener、body、label、assignee、milestone、state(open/closed) |
| Comment | 时间线一等公民 | 可编辑/删除，可加 reaction（👍🎉🚀👀） |
| Reaction | 情绪反馈 | 挂在 issue body / comment 上，不算状态变更 |
| Star / Watch | 收藏 / 订阅 | star 表示"我收藏了"，watch 决定后续通知 |
| Cross-reference | 引用成边 | 正文写 `#123`，两端时间线各出现一条 mentioned/referenced 事件 |
| Label / Milestone / Assignee | 分类 / 批次 / 责任 | 都是时间线事件，可随时增删 |
| State transition | 动作即事件 | Close（带 close reason）/ Reopen |
| Pull Request | 可评审的改进 | diff + review(approve / request changes / comment) + merge，`closes #123` 自动关联 |
| Timeline | 事件流 | opened → commented → labeled → assigned → referenced → closed，就是卡片化视图 |

一句话：**GitHub 把"实体 + 事件流"做成了一切**。状态不是字段，状态变更是事件；讨论、引用、点赞、审阅都往同一条时间线上追加。

---

## 三、落到 imboss 任务系统

### 3.1 现状

- `Task`：`id / title / detail / category / flow / status / assignees / sortOrder / createdAt / updatedAt`。
- `BoardCard` 双源：`task`（手建、可编辑）+ `chat`（从真实任务会话派生、只读、点击进会话）。
- 看板三列：`pending / running / done`。当前形态是"卡片 + 列"，没有讨论、没有引用、没有反馈。

### 3.2 目标模型：**任务即线程**

把 `Task` 从"一条记录"升级为"一条线程 + 一条时间线"：

```
Task (实体)
 ├─ 时间线 events：created / status_changed / assigned / labeled / commented
 │                  / referenced / closed / reopened / proposal
 ├─ comments：评论、提要求、驳回理由、改进提案
 ├─ reactions：like / bookmark(收藏) / follow(订阅，产生通知)
 └─ links：references / duplicates / blocks  →  另一端对称生成事件
```

### 3.3 关键设计点

1. **状态机扩展**：`pending / running / done` 之上加 `closed`，并带 `closeReason: completed | rejected | duplicate | wontfix`。"驳回"是 `closed + rejected`，而不是删除，理由写进时间线。
2. **评论承载语义**：评论带 `kind`：`comment`（讨论）/ `request`（提要求）/ `reject`（驳回）/ `approve` / `improvement`（提出改进）。同一条流里既能聊，也能下判断。
3. **引用成边**：正文里解析 `#<taskId>`，双向生成 `referenced` 事件（对齐 GitHub 的 "referenced this in"）。同时允许把 `chat` 派生卡**关联**到某个 task，形成 task ↔ conversation 的边，让"真实在干的事"和"计划中的事"连起来。
4. **反馈原语**：`like`（赞）、`bookmark`（收藏）、`follow`（订阅，触发通知）三件套，挂在 task 与 comment 上。
5. **改进合并（PR 式）**：对任务提"改进提案" `TaskProposal`，内容是字段变更集（title/detail/flow/assignees 的 diff），流程是 open → review（通过/驳回/评论）→ merged/rejected，通过后应用到 task 并留一条 `proposal_merged` 事件。
6. **卡片化（借 Muse）**：
   - 任务卡结构：icon + 标题 + key-value 元数据（状态/分类/流程/负责人）+ 底部动作条（赞/收藏/关注/评论数）；
   - 看板悬停 → hover 预览卡，不必进详情；
   - "待你决策"的任务与提案用 `ApprovalDeck` 叠成一叠逐张过；
   - 颜色/间距 token 直接对齐 Muse 的语义命名（`--text-primary` / `--fill-*` / `--accent` + 数字刻度），为将来统一主题留口子。
7. **信息架构不变形**：看板（列：待办 / 进行中 / 已完成 / 已关闭）→ 点卡进入任务详情（头部 + 时间线 + 评论框）。复用现有 list/detail 壳，改动集中在 `tasks/` 与 `main/task-board.ts`。

### 3.4 数据表草案

```sql
task_events     (id, task_id, kind, actor, payload_json, created_at)
task_comments   (id, task_id, parent_id, kind, author, body, created_at, updated_at)
task_reactions  (id, task_id, comment_id, actor, kind, created_at)
task_links      (id, from_task_id, to_task_id, kind, created_at)
task_proposals  (id, task_id, author, diff_json, state, created_at, resolved_at)
```

`task_events` 是时间线的物化，`task_comments` 里的每条评论同时追加一条 `commented` 事件。

### 3.5 分期

- **P1（低成本高收益）**：任务详情视图（DetailHead + DetailBody）、评论流、like/bookmark/follow、category 当 label 用、close/reopen + `closed` 状态与 close reason。
- **P2**：`#id` 引用解析 + 双向 cross-reference 事件、task ↔ chat 关联。
- **P3**：PR 式改进提案 + 审批叠卡 + 卡片 impression 埋点。

---

## 四、待确认

1. P1 先行，还是先做 P3 的审批叠卡（视觉冲击大、但依赖提案模型）？
2. 评论的 `author` 是否包含 AI 员工（让 agent 也参与任务讨论、提要求、提改进）？
3. `follow` 的通知走现有通知系统，还是像 Muse 那样单独一条"活动"流？
