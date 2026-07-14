/**
 * Sidebar 组件测试
 * 测试覆盖: role 渲染、active 状态、基础样式
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';

const mockedUsePathname = vi.mocked(usePathname);

describe('Sidebar', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染侧边栏', () => {
      const { container } = render(<Sidebar />);
      expect(container.querySelector('aside')).toBeInTheDocument();
    });

    it('渲染默认 creator 导航项', () => {
      render(<Sidebar role="creator" />);
      expect(screen.getByText('我的任务')).toBeInTheDocument();
      expect(screen.getByText('消息中心')).toBeInTheDocument();
      expect(screen.getByText('个人中心')).toBeInTheDocument();
    });
  });

  // ==================== Role 测试 ====================
  describe('Role', () => {
    it('渲染 agency 导航项', () => {
      render(<Sidebar role="agency" />);
      expect(screen.getByText('工作台')).toBeInTheDocument();
      expect(screen.getByText('审核台')).toBeInTheDocument();
      expect(screen.getByText('任务配置')).toBeInTheDocument();
      expect(screen.getByText('达人管理')).toBeInTheDocument();
      expect(screen.getByText('数据报表')).toBeInTheDocument();
    });

    it('渲染 brand 导航项', () => {
      render(<Sidebar role="brand" />);
      expect(screen.getByText('项目看板')).toBeInTheDocument();
      expect(screen.getByText('AI 配置')).toBeInTheDocument();
      expect(screen.getByText('规则配置')).toBeInTheDocument();
      expect(screen.getByText('终审台')).toBeInTheDocument();
      expect(screen.getByText('代理商管理')).toBeInTheDocument();
    });
  });

  // ==================== Active 状态测试 ====================
  describe('Active 状态', () => {
    beforeEach(() => {
      mockedUsePathname.mockReturnValue('/creator/messages');
    });

    it('激活项使用高亮样式', () => {
      render(<Sidebar role="creator" />);
      const activeLink = screen.getByText('消息中心').closest('a');
      expect(activeLink).toHaveClass('bg-accent-indigo/10', 'text-text-primary');
      expect(screen.getByText('消息中心')).toHaveClass('font-semibold');
    });

    it('非激活项使用默认样式', () => {
      render(<Sidebar role="creator" />);
      const inactiveLink = screen.getByText('我的任务').closest('a');
      expect(inactiveLink).toHaveClass('text-text-secondary');
      expect(inactiveLink).not.toHaveClass('text-text-primary');
    });
  });

  // ==================== 样式测试 ====================
  describe('样式', () => {
    it('固定定位在左侧', () => {
      const { container } = render(<Sidebar />);
      const aside = container.querySelector('aside');
      expect(aside).toHaveClass('fixed', 'left-0', 'top-0', 'bottom-0');
    });

    it('应用正确宽度', () => {
      const { container } = render(<Sidebar />);
      const aside = container.querySelector('aside');
      expect(aside).toHaveClass('w-[260px]');
    });
  });
});
