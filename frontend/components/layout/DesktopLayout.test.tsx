/**
 * DesktopLayout 组件测试
 * 测试覆盖: Sidebar 渲染、内容区域、基础样式
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DesktopLayout } from './DesktopLayout';

describe('DesktopLayout', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染子元素', () => {
      render(
        <DesktopLayout>
          内容区域
        </DesktopLayout>
      );
      expect(screen.getByText('内容区域')).toBeInTheDocument();
    });

    it('渲染 Sidebar', () => {
      const { container } = render(
        <DesktopLayout>
          内容
        </DesktopLayout>
      );
      expect(container.querySelector('aside')).toBeInTheDocument();
    });

    it('渲染默认 creator 导航项', () => {
      render(
        <DesktopLayout role="creator">
          内容
        </DesktopLayout>
      );
      expect(screen.getByText('我的任务')).toBeInTheDocument();
    });
  });

  // ==================== 样式测试 ====================
  describe('样式', () => {
    it('应用背景色', () => {
      const { container } = render(
        <DesktopLayout>
          内容
        </DesktopLayout>
      );
      expect(container.firstChild).toHaveClass('bg-bg-page');
    });

    it('内容区域有左侧边距', () => {
      const { container } = render(
        <DesktopLayout>
          内容
        </DesktopLayout>
      );
      const main = container.querySelector('main');
      expect(main).toHaveClass('ml-[260px]');
    });

    it('支持自定义 className', () => {
      const { container } = render(
        <DesktopLayout className="custom-layout">
          内容
        </DesktopLayout>
      );
      expect(container.firstChild).toHaveClass('custom-layout');
    });
  });
});
