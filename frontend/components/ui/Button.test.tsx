/**
 * Button 组件测试
 * 测试覆盖: variants, sizes, icons, loading, disabled, fullWidth
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Search, ArrowRight } from 'lucide-react';
import { Button } from './Button';

describe('Button', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染按钮文本', () => {
      render(<Button>点击我</Button>);
      expect(screen.getByRole('button', { name: '点击我' })).toBeInTheDocument();
    });

    it('默认使用 primary variant 和 md size', () => {
      render(<Button>默认按钮</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-gradient-to-b', 'from-accent-indigo');
      expect(button).toHaveClass('px-4', 'py-2.5');
    });
  });

  // ==================== Variant 测试 ====================
  describe('Variant 样式', () => {
    it('primary variant 应用正确样式', () => {
      render(<Button variant="primary">Primary</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-gradient-to-b', 'from-accent-indigo', 'text-white');
    });

    it('secondary variant 应用正确样式', () => {
      render(<Button variant="secondary">Secondary</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-bg-elevated', 'text-text-secondary');
    });

    it('danger variant 应用正确样式', () => {
      render(<Button variant="danger">Danger</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-gradient-to-b', 'from-accent-coral', 'text-white');
    });

    it('success variant 应用正确样式', () => {
      render(<Button variant="success">Success</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-gradient-to-b', 'from-accent-green', 'text-white');
    });

    it('ghost variant 应用正确样式', () => {
      render(<Button variant="ghost">Ghost</Button>);
      expect(screen.getByRole('button')).toHaveClass('bg-transparent', 'text-text-secondary');
    });
  });

  // ==================== Size 测试 ====================
  describe('Size 样式', () => {
    it('sm size 应用正确样式', () => {
      render(<Button size="sm">Small</Button>);
      expect(screen.getByRole('button')).toHaveClass('px-3', 'py-1.5', 'text-xs');
    });

    it('md size 应用正确样式', () => {
      render(<Button size="md">Medium</Button>);
      expect(screen.getByRole('button')).toHaveClass('px-4', 'py-2.5', 'text-sm');
    });

    it('lg size 应用正确样式', () => {
      render(<Button size="lg">Large</Button>);
      expect(screen.getByRole('button')).toHaveClass('px-6', 'py-3', 'text-base');
    });
  });

  // ==================== Icon 测试 ====================
  describe('Icon 渲染', () => {
    // 使用 innerHTML 正则匹配验证图标和文本的相对位置
    // 这种方式对 DOM 结构变化（如添加 wrapper）更健壮

    it('左侧图标正确渲染（图标在文本之前）', () => {
      render(<Button icon={Search} iconPosition="left">搜索</Button>);
      const button = screen.getByRole('button');
      expect(button.querySelector('svg')).toBeInTheDocument();
      // 验证 SVG 在 "搜索" 文本之前
      const html = button.innerHTML;
      const svgPos = html.indexOf('<svg');
      const textPos = html.indexOf('搜索');
      expect(svgPos).toBeLessThan(textPos);
    });

    it('右侧图标正确渲染（图标在文本之后）', () => {
      render(<Button icon={ArrowRight} iconPosition="right">下一步</Button>);
      const button = screen.getByRole('button');
      expect(button.querySelector('svg')).toBeInTheDocument();
      // 验证 SVG 在 "下一步" 文本之后
      const html = button.innerHTML;
      const svgPos = html.indexOf('<svg');
      const textPos = html.indexOf('下一步');
      expect(svgPos).toBeGreaterThan(textPos);
    });

    it('默认图标位置为左侧', () => {
      render(<Button icon={Search}>搜索</Button>);
      const button = screen.getByRole('button');
      expect(button.querySelector('svg')).toBeInTheDocument();
      // 验证默认情况下 SVG 在 "搜索" 文本之前
      const html = button.innerHTML;
      const svgPos = html.indexOf('<svg');
      const textPos = html.indexOf('搜索');
      expect(svgPos).toBeLessThan(textPos);
    });
  });

  // ==================== Loading 状态测试 ====================
  describe('Loading 状态', () => {
    it('loading 状态显示加载动画', () => {
      render(<Button loading>加载中</Button>);
      const button = screen.getByRole('button');
      const spinner = button.querySelector('svg.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('loading 状态禁用按钮', () => {
      render(<Button loading>加载中</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('loading 状态应用 opacity-50 样式', () => {
      render(<Button loading>加载中</Button>);
      expect(screen.getByRole('button')).toHaveClass('opacity-40');
    });

    it('loading 状态隐藏原有图标', () => {
      render(<Button loading icon={Search}>搜索</Button>);
      const button = screen.getByRole('button');
      // 应该只有 spinner，没有 Search 图标
      const svgs = button.querySelectorAll('svg');
      expect(svgs).toHaveLength(1);
      expect(svgs[0]).toHaveClass('animate-spin');
    });
  });

  // ==================== Disabled 状态测试 ====================
  describe('Disabled 状态', () => {
    it('disabled 属性禁用按钮', () => {
      render(<Button disabled>禁用</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('disabled 状态应用正确样式', () => {
      render(<Button disabled>禁用</Button>);
      expect(screen.getByRole('button')).toHaveClass('opacity-40', 'cursor-not-allowed');
    });

    it('disabled 状态不触发点击事件', () => {
      const handleClick = vi.fn();
      render(<Button disabled onClick={handleClick}>禁用</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  // ==================== FullWidth 测试 ====================
  describe('FullWidth 属性', () => {
    it('fullWidth 应用 w-full 样式', () => {
      render(<Button fullWidth>全宽按钮</Button>);
      expect(screen.getByRole('button')).toHaveClass('w-full');
    });

    it('非 fullWidth 不应用 w-full 样式', () => {
      render(<Button>普通按钮</Button>);
      expect(screen.getByRole('button')).not.toHaveClass('w-full');
    });
  });

  // ==================== 事件处理测试 ====================
  describe('事件处理', () => {
    it('点击触发 onClick 事件', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>点击</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('多次点击触发多次事件', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>点击</Button>);
      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(3);
    });
  });

  // ==================== 自定义属性测试 ====================
  describe('自定义属性', () => {
    it('支持自定义 className', () => {
      render(<Button className="custom-class">自定义</Button>);
      expect(screen.getByRole('button')).toHaveClass('custom-class');
    });

    it('支持原生 button 属性', () => {
      render(<Button type="submit" data-testid="submit-btn">提交</Button>);
      const button = screen.getByTestId('submit-btn');
      expect(button).toHaveAttribute('type', 'submit');
    });
  });
});
