/**
 * 常量统一导出
 */

export * from './colors';
export * from './icons';

// 布局尺寸常量
export const LAYOUT = {
  // 移动端
  mobile: {
    width: 402,
    height: 874,
    statusBarHeight: 44,
    bottomNavHeight: 83,
    paddingX: 24,
    paddingY: 16,
  },
  // 桌面端
  desktop: {
    minWidth: 1280,
    maxWidth: 1440,
    height: 900,
    sidebarWidth: 260,
    padding: 32,
  },
  // 响应式断点
  breakpoints: {
    mobile: 768,
    tablet: 1024,
    desktop: 1280,
  },
} as const;

// 圆角常量
export const RADIUS = {
  card: 12,
  btn: 8,
  tag: 4,
} as const;

// 间距常量
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

// 字体大小常量
export const FONT_SIZES = {
  pageTitle: 24,
  cardTitle: 22,
  sectionTitle: 16,
  body: 15,
  caption: 13,
  small: 12,
  nav: 11,
} as const;

// 动画时长常量
export const ANIMATION = {
  fast: 150,
  normal: 200,
  slow: 300,
} as const;
