/**
 * Select 下拉选择组件
 * 设计稿参考: UIDesignSpec.md
 */
import React, { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  fullWidth?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  label,
  error,
  hint,
  options,
  placeholder,
  fullWidth = true,
  className = '',
  disabled,
  ...props
}, ref) => {
  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label className="block mb-1.5 text-caption text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          className={`
            w-full bg-bg-elevated text-text-primary
            border border-border-subtle rounded-btn
            px-4 py-2.5 text-body
            appearance-none cursor-pointer
            transition-colors duration-200
            focus:outline-none focus:border-accent-indigo
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? 'border-accent-coral focus:border-accent-coral' : ''}
            ${className}
          `}
          disabled={disabled}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={18}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
        />
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

Select.displayName = 'Select';

export default Select;
