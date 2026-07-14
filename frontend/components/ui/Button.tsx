/**
 * Button 按钮组件
 * 设计稿参考: UIDesignSpec.md 3.4
 */
import React from 'react';
import { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-gradient-to-b from-accent-indigo to-[#5558E3] 
    text-white 
    shadow-[0_1px_0_rgba(255,255,255,0.1)_inset,0_1px_2px_rgba(0,0,0,0.2)]
    hover:opacity-90 active:scale-[0.98]
  `,
  secondary: `
    bg-bg-elevated text-text-secondary 
    border border-border-strong/50
    shadow-sm
    hover:bg-opacity-80 hover:text-text-primary active:scale-[0.98]
  `,
  danger: `
    bg-gradient-to-b from-accent-coral to-[#D14F45] 
    text-white 
    shadow-[0_1px_0_rgba(255,255,255,0.1)_inset,0_1px_2px_rgba(0,0,0,0.2)]
    hover:opacity-90 active:scale-[0.98]
  `,
  success: `
    bg-gradient-to-b from-accent-green to-[#2DAF6E] 
    text-white 
    shadow-[0_1px_0_rgba(255,255,255,0.1)_inset,0_1px_2px_rgba(0,0,0,0.2)]
    hover:opacity-90 active:scale-[0.98]
  `,
  ghost: `
    bg-transparent text-text-secondary 
    hover:bg-bg-elevated hover:text-text-primary active:scale-[0.98]
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

const iconSizes: Record<ButtonSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  fullWidth = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const isDisabled = disabled || loading;
  const iconSize = iconSizes[size];

  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2 font-medium
        rounded-btn transition-all duration-200 outline-none
        focus-visible:ring-2 focus-visible:ring-accent-indigo/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${isDisabled ? 'opacity-40 cursor-not-allowed grayscale-[0.2]' : 'cursor-pointer'}
        ${className}
      `}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin"
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {!loading && Icon && iconPosition === 'left' && (
        <Icon size={iconSize} />
      )}
      {children}
      {!loading && Icon && iconPosition === 'right' && (
        <Icon size={iconSize} />
      )}
    </button>
  );
};

export default Button;
