/**
 * Tag 状态标签组件
 * 设计稿参考: UIDesignSpec.md 3.5
 */
import React from 'react';
import { LucideIcon, Check, Clock, AlertTriangle, XCircle } from 'lucide-react';

export type TagStatus = 'success' | 'pending' | 'warning' | 'error';
export type TagSize = 'sm' | 'md';

export interface TagProps {
  status: TagStatus;
  children: React.ReactNode;
  size?: TagSize;
  icon?: LucideIcon | boolean;
  className?: string;
}

const statusStyles: Record<TagStatus, { bg: string; border: string; text: string; shadow: string; defaultIcon: LucideIcon }> = {
  success: {
    bg: 'bg-accent-green/10',
    border: 'border-accent-green/20',
    text: 'text-accent-green',
    shadow: 'shadow-[0_0_8px_rgba(50,213,131,0.1)]',
    defaultIcon: Check,
  },
  pending: {
    bg: 'bg-accent-indigo/10',
    border: 'border-accent-indigo/20',
    text: 'text-accent-indigo',
    shadow: 'shadow-[0_0_8px_rgba(99,102,241,0.1)]',
    defaultIcon: Clock,
  },
  warning: {
    bg: 'bg-accent-amber/10',
    border: 'border-accent-amber/20',
    text: 'text-accent-amber',
    shadow: 'shadow-[0_0_8px_rgba(255,181,71,0.1)]',
    defaultIcon: AlertTriangle,
  },
  error: {
    bg: 'bg-accent-coral/10',
    border: 'border-accent-coral/20',
    text: 'text-accent-coral',
    shadow: 'shadow-[0_0_8px_rgba(232,90,79,0.1)]',
    defaultIcon: XCircle,
  },
};

const sizeStyles: Record<TagSize, { padding: string; text: string; iconSize: number }> = {
  sm: { padding: 'px-2 py-0.5', text: 'text-[10px]', iconSize: 10 },
  md: { padding: 'px-2.5 py-1', text: 'text-[12px]', iconSize: 13 },
};

export const Tag: React.FC<TagProps> = ({
  status,
  children,
  size = 'md',
  icon,
  className = '',
}) => {
  const styles = statusStyles[status];
  const sizeStyle = sizeStyles[size];

  const showIcon = icon !== false;
  const IconComponent = icon === true || icon === undefined ? styles.defaultIcon : icon;

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-bold uppercase tracking-wider rounded-md
        border ${styles.border} ${styles.bg} ${styles.text} ${styles.shadow}
        ${sizeStyle.padding} ${sizeStyle.text}
        ${className}
      `}
    >
      {showIcon && IconComponent && (
        <IconComponent size={sizeStyle.iconSize} strokeWidth={3} />
      )}
      {children}
    </span>
  );
};

// 预定义的状态标签
export const SuccessTag: React.FC<{ children: React.ReactNode; size?: TagSize }> = ({
  children,
  size,
}) => <Tag status="success" size={size}>{children}</Tag>;

export const PendingTag: React.FC<{ children: React.ReactNode; size?: TagSize }> = ({
  children,
  size,
}) => <Tag status="pending" size={size}>{children}</Tag>;

export const WarningTag: React.FC<{ children: React.ReactNode; size?: TagSize }> = ({
  children,
  size,
}) => <Tag status="warning" size={size}>{children}</Tag>;

export const ErrorTag: React.FC<{ children: React.ReactNode; size?: TagSize }> = ({
  children,
  size,
}) => <Tag status="error" size={size}>{children}</Tag>;

export default Tag;
