/**
 * Input 输入框组件
 * 设计稿参考: UIDesignSpec.md
 */
'use client';
import React, { forwardRef, useId } from 'react';
import { LucideIcon, Search, Eye, EyeOff } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  onRightIconClick?: () => void;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  hint,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  onRightIconClick,
  fullWidth = true,
  className = '',
  disabled,
  id,
  ...props
}, ref) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label htmlFor={inputId} className="block mb-1.5 text-caption text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {LeftIcon && (
          <LeftIcon
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full bg-bg-elevated text-text-primary
            border border-border-subtle rounded-btn
            px-4 py-2.5 text-body
            transition-colors duration-200
            placeholder:text-text-tertiary
            focus:outline-none focus:border-accent-indigo
            disabled:opacity-50 disabled:cursor-not-allowed
            ${LeftIcon ? 'pl-10' : ''}
            ${RightIcon ? 'pr-10' : ''}
            ${error ? 'border-accent-coral focus:border-accent-coral' : ''}
            ${className}
          `}
          disabled={disabled}
          {...props}
        />
        {RightIcon && (
          <button
            type="button"
            onClick={onRightIconClick}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
          >
            <RightIcon size={18} />
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-small text-accent-coral">{error}</p>
      )}
      {hint && !error && (
        <p className="mt-1 text-small text-text-tertiary">{hint}</p>
      )}
    </div>
  );
});

Input.displayName = 'Input';

// 搜索输入框
export const SearchInput = forwardRef<HTMLInputElement, Omit<InputProps, 'leftIcon'>>(
  (props, ref) => (
    <Input ref={ref} leftIcon={Search} placeholder="搜索..." {...props} />
  )
);

SearchInput.displayName = 'SearchInput';

// 密码输入框
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'rightIcon'>>(
  (props, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);

    return (
      <Input
        ref={ref}
        type={showPassword ? 'text' : 'password'}
        rightIcon={showPassword ? EyeOff : Eye}
        onRightIconClick={() => setShowPassword(!showPassword)}
        {...props}
      />
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export default Input;
