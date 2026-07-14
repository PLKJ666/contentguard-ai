/**
 * 颜色常量
 * 设计稿参考: UIDesignSpec.md 1.1
 *
 * 注意：实际运行时颜色通过 CSS 变量动态切换（深色/浅色主题）。
 * 以下为深色主题默认值，仅供 JS 中非 Tailwind 场景参考。
 * 如需运行时取色，使用 getCSSColor() helper。
 */

// 背景色 (深色主题默认)
export const BG_COLORS = {
  page: '#0B0B0E',
  card: '#16161A',
  elevated: '#1A1A1E',
} as const;

// 文字色
export const TEXT_COLORS = {
  primary: '#FAFAF9',
  secondary: '#A1A1AA',
  tertiary: '#71717A',
} as const;

// 强调色
export const ACCENT_COLORS = {
  indigo: '#6366F1',
  green: '#32D583',
  coral: '#E85A4F',
  amber: '#F59E0B',
} as const;

// 边框色
export const BORDER_COLORS = {
  subtle: '#27272A',
} as const;

// 状态色 (带透明度用于背景)
export const STATUS_COLORS = {
  success: {
    bg: 'rgba(50, 213, 131, 0.125)',
    text: '#32D583',
  },
  pending: {
    bg: 'rgba(99, 102, 241, 0.125)',
    text: '#6366F1',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.125)',
    text: '#F59E0B',
  },
  error: {
    bg: 'rgba(232, 90, 79, 0.125)',
    text: '#E85A4F',
  },
} as const;

// CSS 变量名映射
export const CSS_VARS = {
  bgPage: '--bg-page',
  bgCard: '--bg-card',
  bgElevated: '--bg-elevated',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  accentIndigo: '--accent-indigo',
  accentGreen: '--accent-green',
  accentCoral: '--accent-coral',
  accentAmber: '--accent-amber',
  borderSubtle: '--border-subtle',
} as const;

/**
 * 运行时获取 CSS 变量当前值（受主题影响）
 * 返回 rgb(...) 字符串
 */
export function getCSSColor(varName: string): string {
  if (typeof window === 'undefined') return '';
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value ? `rgb(${value.replace(/ /g, ', ')})` : '';
}
