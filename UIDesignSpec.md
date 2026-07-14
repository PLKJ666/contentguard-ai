# UIDesignSpec.md - UI设计规范

| 文档类型 | **UI Design Specification** |
| --- | --- |
| **项目名称** | 内容卫士 AI 审核平台 (AI 营销内容合规审核平台) |
| **版本号** | V1.0 |
| **发布日期** | 2026-02-05 |
| **设计稿文件** | `pencil-new.pen` |
| **设计风格** | Apple-style 暗色主题，商业级/高端质感 |

---

## 1. 设计令牌 (Design Tokens)

### 1.1 颜色系统

```css
/* 背景色 */
--bg-page: #0B0B0E;        /* 页面背景 */
--bg-card: #16161A;        /* 卡片背景 */
--bg-elevated: #1A1A1E;    /* 悬浮/高亮背景 */

/* 文字色 */
--text-primary: #FAFAF9;   /* 主要文字 */
--text-secondary: #A1A1AA; /* 次要文字 */
--text-tertiary: #71717A;  /* 辅助文字 */

/* 强调色 */
--accent-indigo: #6366F1;  /* 主强调色（品牌色） */
--accent-green: #32D583;   /* 成功/通过 */
--accent-coral: #E85A4F;   /* 警告/错误 */
--accent-amber: #F59E0B;   /* 中等风险/警告 */

/* 边框色 */
--border-subtle: #27272A;  /* 细微边框 */
```

### 1.2 字体系统

| 用途 | 字体 | 字重 | 字号 |
| --- | --- | --- | --- |
| 页面标题 | DM Sans | 700 (Bold) | 24px |
| 卡片标题 | DM Sans | 700 (Bold) | 22px |
| 区块标题 | DM Sans | 600 (SemiBold) | 16px |
| 正文内容 | DM Sans | 400 (Regular) | 15px |
| 辅助文字 | DM Sans | 400 (Regular) | 13px |
| 小标签 | DM Sans | 400/600 | 12px |
| 底部导航 | DM Sans | 400 (Regular) | 11px |

### 1.3 间距系统

| 用途 | 数值 |
| --- | --- |
| 页面内边距 (移动端) | 24px 左右，16px 上下 |
| 页面内边距 (桌面端) | 32px |
| 卡片内边距 | 14-16px 上下，16-20px 左右 |
| 卡片圆角 | 12px |
| 按钮圆角 | 8px |
| 标签圆角 | 4px |
| 元素间距 (紧凑) | 4-8px |
| 元素间距 (标准) | 12-16px |
| 元素间距 (宽松) | 20-24px |

---

## 2. 图标规范 (Icon System)

### 2.1 图标库

使用 **Lucide Icons** 图标库，确保全局一致性。

### 2.2 标准图标映射

| 功能 | 图标名称 | 使用场景 |
| --- | --- | --- |
| 工作台/首页 | `house` | 底部导航、侧边栏 |
| 任务 | `clipboard-list` | 底部导航、任务列表 |
| 审核/审批 | `circle-check` | 底部导航、审批中心 |
| 审核台 | `clipboard-check` | 侧边栏导航 |
| 消息/通知 | `bell` | 底部导航、消息中心 |
| 个人中心 | `user` | 底部导航、我的 |
| 达人管理 | `users` | 侧边栏导航 |
| 数据看板/报表 | `chart-column` | 底部导航、侧边栏 |
| 代理商管理 | `building-2` | 侧边栏导航 |
| 终审台 | `shield-check` | 侧边栏导航 |
| 系统设置 | `settings` | 侧边栏导航 |
| Brief管理 | `file-text` | 侧边栏导航 |
| 版本比对 | `git-compare` | 侧边栏导航 |
| 筛选 | `sliders-horizontal` | 筛选按钮 |
| 搜索 | `search` | 搜索框 |
| 添加 | `plus` | 添加按钮 |
| 编辑 | `pencil` | 编辑操作 |
| 查看 | `eye` | 查看详情 |
| 下载/导出 | `download` | 导出按钮 |
| 箭头右 | `chevron-right` | 列表项箭头 |
| 箭头下 | `chevron-down` | 下拉选择 |
| 信号 | `signal` | 状态栏 |
| WiFi | `wifi` | 状态栏 |
| 安全 | `shield-check` | 隐私与安全 |
| 信息 | `info` | 关于我们 |
| 消息气泡 | `message-circle` | 帮助与反馈 |

### 2.3 图标尺寸

| 场景 | 尺寸 |
| --- | --- |
| 底部导航 | 24x24px |
| 侧边栏导航 | 20x20px |
| 按钮内图标 | 16x16px |
| 状态栏图标 | 16x16px |

---

## 3. 组件规范 (Component Specs)

### 3.1 移动端布局 (402x874)

```
┌─────────────────────────────┐
│  状态栏 (44px)              │
│  9:41          📶 📡 🔋    │
├─────────────────────────────┤
│                             │
│  内容区                      │
│  padding: 16px 24px         │
│  gap: 16-20px               │
│  flex: 1                    │
│                             │
├─────────────────────────────┤
│  底部导航 (83px)            │
│  渐变背景 + space-around    │
└─────────────────────────────┘
```

### 3.2 桌面端布局 (1440x900)

```
┌────────────┬────────────────────────────────┐
│            │                                │
│  侧边栏     │  主内容区                       │
│  260px     │  padding: 32px                 │
│  bg-card   │  gap: 24px                     │
│            │                                │
│  Logo      │  标题栏                         │
│  导航菜单   │  内容区域                       │
│            │                                │
└────────────┴────────────────────────────────┘
```

### 3.3 卡片组件

```css
.card {
  background: var(--bg-card);     /* #16161A */
  border-radius: 12px;
  padding: 14px 16px;             /* 移动端 */
  padding: 16px 20px;             /* 桌面端 */
}
```

### 3.4 按钮组件

**主要按钮 (Primary)**
```css
.btn-primary {
  background: var(--accent-indigo);  /* #6366F1 */
  color: #FFFFFF;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 8px;
}
```

**次要按钮 (Secondary)**
```css
.btn-secondary {
  background: var(--bg-elevated);    /* #1A1A1E */
  color: var(--text-secondary);      /* #A1A1AA */
  padding: 8px 16px;
  border-radius: 8px;
}
```

### 3.5 状态标签

| 状态 | 背景色 | 文字色 |
| --- | --- | --- |
| 已通过/活跃 | #32D58320 | #32D583 |
| 待处理/进行中 | #6366F120 | #6366F1 |
| 风险/错误 | #E85A4F20 | #E85A4F |
| 警告/中风险 | #F59E0B20 | #F59E0B |

### 3.6 底部导航

```css
.bottom-nav {
  height: 83px;
  padding: 12px 21px;
  background: linear-gradient(180deg, transparent 0%, #0B0B0E 50%);
  display: flex;
  justify-content: space-around;
  align-items: center;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.nav-item.active {
  color: var(--accent-indigo);  /* #6366F1 */
}

.nav-item.inactive {
  color: var(--text-secondary); /* #A1A1AA */
}
```

### 3.7 侧边栏导航项

```css
.sidebar-nav-item {
  padding: 10px 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
}

.sidebar-nav-item.active {
  background: var(--bg-elevated);  /* #1A1A1E */
  color: var(--accent-indigo);     /* #6366F1 */
  font-weight: 600;
}
```

---

## 4. 页面清单 (Screen Inventory)

### 4.1 达人端 (Creator)

> **两阶段审核说明：** 每个任务包含「脚本阶段」和「视频阶段」两轮审核

#### 4.1.1 Mobile 端页面

| 页面名称 | 阶段 | 优先级 | 设计稿节点ID | 备注 |
| --- | --- | --- | --- | --- |
| 任务列表 | 通用 | P0 | PjBJD | 含历史任务入口 |
| 脚本上传区 | 脚本阶段 | P0 | ZelCS | 上传脚本文档 |
| 脚本AI审核中 | 脚本阶段 | P0 | lzdm4 | 透明思考UI |
| 脚本AI审核通过 | 脚本阶段 | P0 | Vn3VU | 结果页，含「下一步：上传视频」 |
| 脚本AI审核不通过 | 脚本阶段 | P0 | cjcZZ | 结果页，含「重新提交脚本」 |
| 脚本代理商审核通过 | 脚本阶段 | P0 | IyLsO | 结果页 |
| 脚本代理商审核不通过 | 脚本阶段 | P0 | zU3Op | 结果页，含「重新提交脚本」 |
| 脚本品牌方审核通过 | 脚本阶段 | P0 | f6T3z | 结果页 |
| 脚本品牌方审核不通过 | 脚本阶段 | P0 | NeF4L | 结果页，含「重新提交脚本」 |
| 视频上传区 | 视频阶段 | P0 | (待补充) | 上传视频文件 |
| 视频AI审核中 | 视频阶段 | P0 | (待补充) | 透明思考UI |
| 视频AI审核通过 | 视频阶段 | P0 | (待补充) | 结果页 |
| 视频AI审核不通过 | 视频阶段 | P0 | 6EX4Z | 结果页，含「重新上传视频」 |
| 视频代理商审核通过 | 视频阶段 | P0 | (待补充) | 结果页 |
| 视频代理商审核不通过 | 视频阶段 | P0 | (待补充) | 结果页，含「重新上传视频」 |
| 视频品牌方审核通过 | 视频阶段 | P0 | (待补充) | 结果页，含「审核通过，可发布」 |
| 视频品牌方审核不通过 | 视频阶段 | P0 | (待补充) | 结果页，含「重新上传视频」 |
| 消息中心 | 通用 | P1 | pF15t | 两阶段审核通知 |
| 历史记录 | 通用 | P2 | ZKEFl | 当日00:00后自动归档 |
| 个人中心 | 通用 | P2 | zCdM1 | - |

#### 4.1.2 Desktop 端页面

| 页面名称 | 阶段 | 优先级 | 设计稿节点ID | 备注 |
| --- | --- | --- | --- | --- |
| 任务列表 | 通用 | P0 | HD3eK | 含历史任务入口 |
| 脚本上传区 | 脚本阶段 | P0 | N79bL | 上传脚本文档 |
| 脚本AI审核中 | 脚本阶段 | P0 | bxAKT | 透明思考UI |
| 脚本审核结果 | 脚本阶段 | P0 | 3niUa | 通用结果页 |
| 消息中心 | 通用 | P1 | 8XKLP | 两阶段审核通知 |

### 4.2 代理商端 (Agency)

> **侧边栏导航顺序：** 工作台 → 审核台 → Brief配置 → 达人管理 → 数据报表 → 消息中心

#### 4.2.1 Desktop 端页面

| 页面名称 | 优先级 | 设计稿节点ID | 备注 |
| --- | --- | --- | --- |
| 工作台 | P0 | RX8V9 | 待办统计+快捷入口，默认首页 |
| 项目详情 | P0 | C7wfV | 项目数据和达人列表 |
| 审核台(列表页) | P0 | zjiCT | 脚本/视频待审列表 |
| 脚本审核决策台 | P0 | f8HX9 | 简单模式(文件图标+预览按钮) |
| 脚本审核(预览模式) | P0 | Wct5R | 展开脚本内容+AI分析 |
| 视频审核决策台 | P0 | 2u8Bq | 视频播放+问题标记+决策 |
| Brief配置中心(列表页) | P0 | Nicby | 待配置/已配置列表 |
| Brief配置详情(待配置) | P0 | jRsW5 | 上传Brief+配置规则 |
| Brief配置详情(已配置) | P0 | b06fU | 查看/编辑配置 |
| 达人管理 | P1 | 5cFMX | 达人列表+邀请 |
| 邀请达人弹窗 | P1 | ADN10 | 邀请达人模态框 |
| 数据报表 | P1 | An8gw | 项目数据统计 |
| 消息中心 | P1 | PfMR0 | 通知列表 |

#### 4.2.2 Mobile 端页面

| 页面名称 | 优先级 | 设计稿节点ID | 备注 |
| --- | --- | --- | --- |
| 工作台 | P0 | VuH3F | 紧急待办概览 |
| 快捷审核 | P0 | lrHaj | 外出场景审核 |
| 任务列表 | P1 | c6SPa | 任务筛选 |
| 消息中心 | P1 | 9Us9g | 通知列表 |
| 个人中心 | P2 | 8OCZ3 | 个人设置 |

#### 4.2.3 页面跳转关系

```
侧边栏导航
├── 工作台 ───────────► 我的项目 [查看] → 项目详情
│                      紧急待办 [审核] → 审核决策台
├── 审核台 ───────────► 审核台(列表页)
│   ├── 脚本任务 ────► 脚本审核决策台 ─► 预览脚本按钮 → 预览模式
│   └── 视频任务 ────► 视频审核决策台
├── Brief配置 ────────► Brief配置中心(列表页)
│   ├── 待配置项目 ──► Brief配置详情(待配置) ─► 保存 → 已配置列表
│   └── 已配置项目 ──► Brief配置详情(已配置)
├── 达人管理 ─────────► 邀请按钮 → 邀请达人弹窗
├── 数据报表 ─────────► 数据报表页
└── 消息中心 ─────────► 消息中心页
```

### 4.3 品牌方端 (Brand)

> **侧边栏导航顺序：** 项目看板 → 创建项目 → 终审台 → 代理商管理 → 规则配置 → AI配置 → 系统设置

#### 4.3.1 Desktop 端页面

| 页面名称 | 优先级 | 设计稿节点ID | 备注 |
| --- | --- | --- | --- |
| 项目看板 | P0 | xUM9m | 项目列表与数据概览，默认首页 |
| 项目详情数据看板 | P1 | D1O6f | 单项目数据分析 |
| 创建项目 | P0 | fP5rY | 新建项目表单 |
| 终审台(列表页) | P0 | afJEU | 脚本/视频待终审列表 |
| 脚本终审决策台 | P0 | Sw2hw | 简单模式(文件图标+预览按钮) |
| 脚本终审(预览模式) | P0 | cp5CE | 展开脚本内容审核 |
| 视频终审决策台 | P0 | aePi5 | 视频播放+问题标记+决策 |
| 代理商管理 | P1 | 2jnnO | 代理商列表与邀请 |
| 邀请代理商弹窗 | P1 | GyUlM | 邀请代理商模态框 |
| 规则配置 | P0 | nhHSF | 黑名单/白名单管理 |
| AI服务配置 | P0 | 4ppiJ | AI模型与参数配置 |
| 系统设置 | P2 | 4nVj4 | 通用设置、安全、数据导出 |

#### 4.3.2 Mobile 端页面

| 页面名称 | 优先级 | 设计稿节点ID | 备注 |
| --- | --- | --- | --- |
| 数据看板 | P0 | lpVdV | 关键指标概览 |
| 审批中心 | P1 | OueOe | 终审处理 |
| 消息中心 | P2 | 1w9xC | 通知列表 |
| 我的 | P2 | OJBbT | 个人设置 |

#### 4.3.3 页面跳转关系

```
侧边栏导航
├── 项目看板 ─────────► 点击项目卡片 → 项目详情数据看板
├── 创建项目 ─────────► 填写表单 → 保存 → 项目看板
├── 终审台 ───────────► 终审台(列表页)
│   ├── 脚本任务 ────► 脚本终审决策台 ─► 预览脚本按钮 → 预览模式
│   └── 视频任务 ────► 视频终审决策台
├── 代理商管理 ───────► 邀请按钮 → 邀请代理商弹窗
├── 规则配置 ─────────► 黑名单/白名单管理
├── AI配置 ───────────► AI服务配置页
└── 系统设置 ─────────► 系统设置页
```

---

## 5. 开发实施指南

### 5.1 技术栈建议

- **前端框架**: React / Vue 3
- **样式方案**: Tailwind CSS (推荐) 或 CSS Variables
- **图标库**: `lucide-react` / `lucide-vue-next`
- **字体**: Google Fonts - DM Sans

### 5.2 Tailwind CSS 配置

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'bg-page': '#0B0B0E',
        'bg-card': '#16161A',
        'bg-elevated': '#1A1A1E',
        'text-primary': '#FAFAF9',
        'text-secondary': '#A1A1AA',
        'text-tertiary': '#71717A',
        'accent-indigo': '#6366F1',
        'accent-green': '#32D583',
        'accent-coral': '#E85A4F',
        'accent-amber': '#F59E0B',
        'border-subtle': '#27272A',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
      borderRadius: {
        'card': '12px',
        'btn': '8px',
        'tag': '4px',
      },
    },
  },
}
```

### 5.3 CSS Variables 配置

```css
:root {
  /* 背景 */
  --bg-page: #0B0B0E;
  --bg-card: #16161A;
  --bg-elevated: #1A1A1E;

  /* 文字 */
  --text-primary: #FAFAF9;
  --text-secondary: #A1A1AA;
  --text-tertiary: #71717A;

  /* 强调色 */
  --accent-indigo: #6366F1;
  --accent-green: #32D583;
  --accent-coral: #E85A4F;
  --accent-amber: #F59E0B;

  /* 边框 */
  --border-subtle: #27272A;

  /* 字体 */
  --font-family: 'DM Sans', sans-serif;
}
```

### 5.4 开发检查清单

开发每个页面时，请对照以下检查项：

- [ ] 背景色使用 `--bg-page` (#0B0B0E)
- [ ] 卡片使用 `--bg-card` (#16161A) + 12px圆角
- [ ] 字体统一使用 DM Sans
- [ ] 图标使用 Lucide，按照图标映射表选择正确图标
- [ ] 底部导航高度 83px，渐变背景
- [ ] 侧边栏宽度 260px
- [ ] 状态标签使用对应颜色（通过=绿色，处理中=紫色，错误=红色）
- [ ] 按钮样式符合规范（主要=紫色，次要=深灰色）

---

## 6. 设计稿访问

设计稿文件：`pencil-new.pen`

使用 Pencil 编辑器打开查看完整设计，可通过节点ID定位到具体页面。

---

**文档维护者**: Claude
**最后更新**: 2026-02-06

---

## 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
| --- | --- | --- | --- |
| V1.0 | 2026-02-03 | Claude | 初稿：设计令牌、组件规范、页面清单 |
| V1.1 | 2026-02-05 | Claude | **明确两阶段审核页面**：细化达人端页面清单，按脚本阶段/视频阶段分类；新增脚本品牌方不通过(NeF4L)、视频AI不通过(6EX4Z)页面 |
| V1.2 | 2026-02-06 | Claude | **完善品牌方端和代理商端页面清单**：更新侧边栏导航顺序；新增规则配置、脚本终审(预览模式)等页面；补充页面跳转关系图 |
