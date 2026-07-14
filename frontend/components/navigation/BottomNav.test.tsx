/**
 * BottomNav 组件测试
 * 测试覆盖: role 渲染、active 状态、基础样式
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePathname } from 'next/navigation';
import { BottomNav } from './BottomNav';

const mockedUsePathname = vi.mocked(usePathname);

describe('BottomNav', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染导航栏', () => {
      const { container } = render(<BottomNav />);
      expect(container.firstChild).toBeInTheDocument();
    });

    it('渲染所有导航项', () => {
      render(<BottomNav role="creator" />);
      expect(screen.getByText('任务')).toBeInTheDocument();
      expect(screen.getByText('消息')).toBeInTheDocument();
      expect(screen.getByText('我的')).toBeInTheDocument();
    });

    it('渲染图标', () => {
      const { container } = render(<BottomNav />);
      const icons = container.querySelectorAll('svg');
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  // ==================== Active 状态测试 ====================
  describe('Active 状态', () => {
    beforeEach(() => {
      mockedUsePathname.mockReturnValue('/creator/messages');
    });

    it('激活项使用高亮颜色', () => {
      render(<BottomNav role="creator" />);
      const activeLink = screen.getByText('消息').closest('a');
      expect(activeLink).toHaveClass('text-text-primary');
    });

    it('非激活项使用次要颜色', () => {
      render(<BottomNav role="creator" />);
      const inactiveLink = screen.getByText('任务').closest('a');
      expect(inactiveLink).toHaveClass('text-text-secondary');
    });
  });

  // ==================== 样式测试 ====================
  describe('样式', () => {
    it('固定定位在底部', () => {
      const { container } = render(<BottomNav />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0');
    });
  });
});
