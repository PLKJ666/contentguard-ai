/**
 * Card 卡片组件
 * 设计稿参考: UIDesignSpec.md 3.3
 */
import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'default' | 'elevated';
  padding?: 'mobile' | 'desktop' | 'none';
  hoverable?: boolean;
}

const paddingStyles = {
  mobile: 'p-[14px_16px]',
  desktop: 'p-[16px_20px]',
  none: 'p-0',
};

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  padding = 'mobile',
  hoverable = false,
  onClick,
  ...props
}) => {
  return (
    <div
      className={`
        bg-bg-card rounded-card border border-border-subtle
        transition-all duration-300 ease-in-out
        ${paddingStyles[padding]}
        ${variant === 'elevated' ? 'bg-bg-elevated shadow-elevated border-border-strong/50' : 'shadow-sm'}
        ${hoverable ? 'cursor-pointer hover:border-accent-indigo/30 hover:shadow-indigo/10 hover:translate-y-[-2px]' : ''}
        ${onClick ? 'active:scale-[0.99]' : ''}
        ${className}
      `}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div className={`flex items-center justify-between mb-4 pb-2 border-b border-border-subtle/20 ${className}`}>
    {children}
  </div>
);

export const CardTitle: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <h3 className={`text-base text-text-primary font-medium tracking-tight ${className}`}>
    {children}
  </h3>
);

export const CardContent: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div className={`text-sm text-text-secondary leading-relaxed ${className}`}>{children}</div>
);

export const CardFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div className={`mt-4 pt-4 border-t border-border-subtle ${className}`}>
    {children}
  </div>
);

export default Card;
