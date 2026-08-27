# Kanban 任务看板 Notion 化重设计 — Design Spec

- Date: 2026-08-27
- Status: Draft (awaiting review)
- Author: brainstorming with user
- Scope: Architectural — 解耦 Task（人）与 SessionRun（AI 子任务），实现 Notion Database 式看板闭环

## 1. 背景与问题

现有 `BoardView.vue` 只是把 `sessionStatus.ts: deriveBoardStatus()` 的 5 个 AI 运行时状态（running/queued/permission/done/stopped）可视化 + 拖拽写 `statusOverride` 假归列。痛点：

- AI 运行状态 ≠ 人任务状态。AI 跑完进"已完成"，但人可能还在验收/迭代，任务并未完成
- 看板上不能直接"想做什么先建任务"，必须先有会话
- 卡片不可 inline 编辑属性，筛选/排序/搜索缺失，拖拽不驱动真实工作流
- 闭环断在"建→发→验→归档"，无法沉淀复用

目标：像 Notion Database 一样，任务为一等实体，会话服务于任务，闭环跑通。

## 2. 目标与非目标

**目标（首版）：**

- 独立 `Task` 实体，全局跨项目看板，按人任务状态分列
- 卡片 Notion 式展示：标题/priority/tags/dueAt/updatedAt/project + AI 执行徽标
- 任务详情抽屉：属性 inline 编辑 + 备注 + Session 列表（新建/继续/重试）
- 闭环：新建空任务 → 发起会话 → 实时徽标 → 人标记完成 → 归档 → 基于此再建
- 本地 IndexedDB 持久化，Filter/Search/Sort 基础可用

**非目标（后续）：**

- 服务端同步/多端协作
- 批量多选操作、自定义列（数据结构预留，UI 暂不开放）
- 封面/图标、富文本备注、高级模板市场
- 任务指派/评论

## 3. 架构总览

```
Chat.vue (orchestrator)
├── TaskBoardView.vue (全局任务看板，按 Task.status 分列)
│   └── TaskCard.vue × N (Notion 行：标题/tags/priority/due + Session 徽标)
├── TaskDetailDrawer.vue (任务 Page)
│   ├── TaskPropertyBar.vue (inline 编辑：status/priority/tags/due/project只读)
│   ├── DescriptionEditor.vue (textarea)
│   └── SessionList.vue → SessionRow.vue × N (关联会话，复用 sessionStatus 信号)
└── ChatDrawer (复用现有会话抽屉，二层叠加，openKey=sessionKey)

数据层
├── services/taskStorage.ts (新增，Task CRUD + 防抖持久化)
├── services/localDatabase.ts (DB_VERSION 1→2，新增 store "tasks")
├── services/chatStorage.ts (不变，Conversation 仍存 app-state)
└── utils/sessionStatus.ts (不变，降为 Session 徽标数据源)
└── utils/taskStatus.ts (新增，TASK_STATUS_ORDER/META)
```

**关键决策：** `Task.sessionKeys: string[]` 单向持有 `Conversation.key`，Conversation 不反向存 `taskId`，首版避免双向同步；查会话归属需遍历 tasks（O(N)，任务量 <1k 可接受）。

## 4. 数据模型

### 4.1 Task

```ts
type TaskStatus = "todo" | "doing" | "review" | "done" | "archived";
type TaskPriority = "P0" | "P1" | "P2" | "P3" | null;

interface Task {
  id: string; // nanoid 12
  title: string;
  status: TaskStatus; // 看板列，默认 "todo"
  priority: TaskPriority;
  tags: string[]; // 去重，trim
  dueAt: number | null; // ms timestamp
  description: string;
  projectPath: string | null; // 创建时选定，后续 immutable
  createdAt: number;
  updatedAt: number; // 任何属性/关联变更刷新，用于排序与"更新时间"
  sessionKeys: string[]; // 追加，最新在尾
}

const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "doing", "review", "done", "archived"];
const TASK_STATUS_META: Record<TaskStatus, { name: string; hint: string }> = {
  todo: { name: "待办", hint: "待开始" },
  doing: { name: "进行中", hint: "任务执行中" },
  review: { name: "待验收", hint: "AI 已交付待人验收" },
  done: { name: "已完成", hint: "已验收" },
  archived: { name: "已归档", hint: "已沉淀" },
};
```

### 4.2 关联规则

- 任务可空：`sessionKeys=[]` 允许先建任务再发 AI
- 发起会话：`createConversation({ taskId, projectPath: task.projectPath })` → 新 key → `task.sessionKeys.push(key)` → `task.updatedAt=now` → 若 `task.status==="todo"` 自动切 `doing`（可配置关闭）
- `projectPath` immutable：写入后 UI 禁用，Tooltip 提示"创建后不可更改"；全局看板按 projectPath 过滤
- 删除：删 Task 仅删 Task 记录，不级联删 Conversation；归档仅 `status=archived`
- 更新：任何属性变更、拖拽改列、关联会话变更均刷新 `updatedAt` + `saveTasks()` 防抖 300ms

### 4.3 持久化

- `localDatabase.ts`: `DB_VERSION=2`, `onupgradeneeded` 创建 `db.createObjectStore("tasks", { keyPath: "id" })`
- `taskStorage.ts`: `loadTasks(): Promise<Task[]>`, `saveTasks(tasks: Task[])`, `createTask()`, `updateTask()`, 内部 `JSON.parse(JSON.stringify)` 去响应式
- 迁移：老库无 tasks，首启空状态引导；现有 `OpenChatConversation.statusOverride/lastError` 保留但不再驱动看板列
- 索引：Filter/Sort/Search 状态存 `localDatabase` key `task-board-filters`

## 5. 看板视图（Board）

**组件：** `TaskBoardView.vue` 重构自 `BoardView.vue`，`TaskCard.vue` 抽出

**列：**

- 按 `TASK_STATUS_ORDER` 渲染 5 列，列头 `name · count` + `hint`，横向滚动 `.board-scroll`
- 数据：`filteredTasks = computed(() => tasks.filter(bySearch+byFilter).sort(bySort))` 再按 `status` 分组

**卡片（Notion 行）：**

- 首行：标题（单行截断，双击 inline 编辑 Input）+ 优先级色点（P0红/P1橙/P2蓝/P3灰）
- 第二行：tags 胶囊（最多3 + `+N`）、projectName（`projectPath.split` 末段）
- 第三行：dueAt（`relativeTime` + 逾期红字"已逾期 2 天"）、updatedAt 相对时间
- 底栏：Session 徽标（取 `sessionKeys` 最后一个会话，调用 `deriveBoardStatus(conversation, signals)` + `elapsedDuration`，无会话显示"未开始"）+ `· N 个会话` + 右键菜单（改状态/优先级/标签/归档/基于此再建/删除）
- 拖拽：`draggable`, `handleDrop(status)` → `task.status=status` + `updatedAt` + 持久化 + `message.success`

**顶部栏：**

- 左：`任务看板 · 12 个任务 · 进行中 3`
- 中：Search 输入（搜 title/description/tags/project）
- 右：Filter 下拉（priority/tags/project/due 状态）、Sort 下拉（updatedAt/dueAt/priority/createdAt）、`+ 新建任务` 主按钮
- 空列：复用"暂无任务/松开移动到这里"；空看板：Notion 引导 + 模板入口

## 6. 任务详情抽屉 + Session 列表

**触发：** 点击卡片 → `TaskDetailDrawer.vue`（`Drawer` 宽 560px）

**结构：**

1. **属性区**（两列网格）：
   - 标题大字 Input，blur 保存
   - 状态下拉、优先级下拉、标签 `a-select mode=tags`、截止 `a-date-picker`、项目只读置灰、更新只读
   - 任何改动 `updatedAt` + 防抖保存

2. **备注：**
   - `a-textarea` 占位"写下这个任务要做什么..."，首版 plain text，预留 markdown

3. **Session 列表：**
   - 标题 `AI 会话 · N` + 右侧 `+ 新建会话`（无会话时"开始对话"）/ `继续最近`
   - `SessionRow.vue` 按 `createdAt` 倒序：会话标题 + agent/model + 执行徽标（running 带 `elapsedDuration` 脉动/permission 黄点/stopped 红字+lastError tooltip/done）+ 相对时间 + 菜单（查看/重试/删除关联）
   - 点击行 → 二层 `ChatDrawer`（复用 `Chat.vue:2842` 会话抽屉，`openKey=sessionKey`），聊天结束不自动改任务状态，需人手动标记
   - 空态：提示 + 极简输入框（复用 `ChatInput`）直接发往新会话
   - 新建会话：`createConversation` 带 `projectPath` → 回写 `sessionKeys` → 立即打开 ChatDrawer；重试：复制最后 user message 新开会话关联同一任务

## 7. 闭环交互

**新建：**

- 入口：头 `+ 新建任务` / 列底 `+ 新建`（预设该列 status）/ 空看板引导 / CommandPalette
- 表单：标题必填，projectPath 下拉（来自 `projectPicker`，可选"无项目"），其余可选；确定后 `tasks.unshift` 置顶
- 模板：新建旁 `▾` 展开 空白/修 Bug/新功能/重构，仅预填 tags+description 占位

**发起/继续：**

- 卡片/详情 `发起会话` 文案自适应；发起时 `description+title` 拼首条 user message（可编辑）
- 最新会话徽标实时跟随 `busyStates/permissionKeys/queuedMessages`（复用现有信号）

**验收：**

- 不自动改 status；人点`标记为待验收/已完成` → `task.status=review/done` → 卡片漂列
- 已终止重试：Session 行 `重试` → 新会话关联同一任务

**归档/复用：**

- 已完成 → 菜单 `归档` → `archived` 列；`基于此再建` → 复制 title/priority/tags/projectPath/description 新任务（sessionKeys 清空）

**体感：**

- 卡片标题双击 inline 编辑，priority/tags 右键快改
- 拖拽高亮 + Toast，可选撤销
- Filter/Sort/Search 持久化

## 8. 边界与错误

- projectPath 不可变校验：`updateTask` 若 `projectPath` 变更抛错，UI 禁用为第一道防线
- 删 Task 不删 Conversation，悬空会话仍可通过搜索找到
- IndexedDB 失败：`message.error` + 内存态保留，回滚 `updatedAt`
- 会话创建失败：不写 `sessionKeys`，Toast 重试
- 防抖：`saveTasks` 300ms，快速拖拽只落最后一次
- 升级：DB_VERSION 迁移幂等，老数据空 tasks 引导

## 9. 测试策略

- 单元：`taskStorage` CRUD、status 流转、projectPath 不可变、`dueAt` 逾期、`updatedAt` 刷新；`taskStatus` 常量
- 组件：TaskBoardView 分组/筛选/搜索/排序/拖拽；TaskCard 徽标与标签截断；TaskDetailDrawer inline 编辑与 Session 列表联动
- 行为 E2E：新建空任务 → 发起会话 → 徽标脉动 → 标记完成 → 归档 → 基于此再建；全局看板按项目过滤

## 10. 实施顺序（供 writing-plans 拆分）

1. Phase 1 — 数据层：`taskStorage.ts` + `localDatabase` v2 + `taskStatus` + 单元测试
2. Phase 2 — 看板重构：`TaskCard` + `TaskBoardView`（含 Filter/Search/Sort 基础）+ 全局看板接线
3. Phase 3 — 详情抽屉：`TaskDetailDrawer` + 属性编辑 + SessionList 接会话创建/打开
4. Phase 4 — 闭环打磨：模板、重试、归档、复用、空态、Toast、持久化 Filter

## 11. 未来扩展

- 自定义列（在 `TASK_STATUS_ORDER` 上加配置 UI）
- 封面/图标、富文本描述、任务评论
- 服务端同步（将 `tasks` store 换 API）
- 批量操作、看板/列表/表格多视图

---

Spec self-review: 已检查无 TBD/TODO，占位已填，章节无矛盾，范围聚焦单次实施。
