/**
 * 图标映射常量
 * 设计稿参考: UIDesignSpec.md 2.2
 * 使用 Lucide Icons 图标库
 */

// 导航图标映射
export const NAV_ICONS = {
  // 通用导航
  home: 'house',              // 工作台/首页
  tasks: 'clipboard-list',    // 任务
  review: 'circle-check',     // 审核/审批
  reviewDesk: 'clipboard-check', // 审核台
  messages: 'bell',           // 消息/通知
  profile: 'user',            // 个人中心

  // 侧边栏导航
  creators: 'users',          // 达人管理
  dashboard: 'chart-column',  // 数据看板/报表
  agencies: 'building-2',     // 代理商管理
  finalReview: 'shield-check', // 终审台
  settings: 'settings',       // 系统设置
  brief: 'file-text',         // Brief管理
  versionCompare: 'git-compare', // 版本比对
} as const;

// 操作图标映射
export const ACTION_ICONS = {
  filter: 'sliders-horizontal', // 筛选
  search: 'search',             // 搜索
  add: 'plus',                  // 添加
  edit: 'pencil',               // 编辑
  view: 'eye',                  // 查看
  download: 'download',         // 下载/导出
  arrowRight: 'chevron-right',  // 箭头右
  arrowDown: 'chevron-down',    // 箭头下
} as const;

// 状态栏图标映射
export const STATUS_BAR_ICONS = {
  signal: 'signal',
  wifi: 'wifi',
  battery: 'battery-full',
} as const;

// 其他图标映射
export const MISC_ICONS = {
  security: 'shield-check',     // 隐私与安全
  info: 'info',                 // 关于我们
  help: 'message-circle',       // 帮助与反馈
} as const;

// 图标尺寸常量
export const ICON_SIZES = {
  bottomNav: 24,
  sidebar: 20,
  button: 16,
  statusBar: 16,
} as const;

// Lucide React 图标导入映射 (便于动态使用)
export const LUCIDE_ICON_MAP = {
  'house': 'House',
  'clipboard-list': 'ClipboardList',
  'circle-check': 'CircleCheck',
  'clipboard-check': 'ClipboardCheck',
  'bell': 'Bell',
  'user': 'User',
  'users': 'Users',
  'chart-column': 'ChartColumn',
  'triangle-alert': 'TriangleAlert',
  'building-2': 'Building2',
  'scroll-text': 'ScrollText',
  'settings': 'Settings',
  'file-text': 'FileText',
  'git-compare': 'GitCompare',
  'sliders-horizontal': 'SlidersHorizontal',
  'search': 'Search',
  'plus': 'Plus',
  'pencil': 'Pencil',
  'eye': 'Eye',
  'download': 'Download',
  'chevron-right': 'ChevronRight',
  'chevron-down': 'ChevronDown',
  'signal': 'Signal',
  'wifi': 'Wifi',
  'battery-full': 'BatteryFull',
  'shield-check': 'ShieldCheck',
  'info': 'Info',
  'message-circle': 'MessageCircle',
} as const;
