/**
 * MobileLayout 组件测试
 * 测试覆盖: StatusBar、BottomNav 显示、内容区域样式
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MobileLayout } from './MobileLayout';

describe('MobileLayout', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染子元素', () => {
      render(<MobileLayout>内容区域</MobileLayout>);
      expect(screen.getByText('内容区域')).toBeInTheDocument();
    });

    it('默认显示状态栏', () => {
      render(<MobileLayout>内容</MobileLayout>);
      expect(screen.getByText('9:41')).toBeInTheDocument();
    });

    it('默认显示底部导航', () => {
      render(<MobileLayout role="creator">内容</MobileLayout>);
      expect(screen.getByText('任务')).toBeInTheDocument();
    });
  });

  // ==================== StatusBar 测试 ====================
  describe('StatusBar', () => {
    it('showStatusBar=true 显示状态栏', () => {
      render(<MobileLayout showStatusBar={true}>内容</MobileLayout>);
      expect(screen.getByText('9:41')).toBeInTheDocument();
    });

    it('showStatusBar=false 隐藏状态栏', () => {
      render(<MobileLayout showStatusBar={false}>内容</MobileLayout>);
      expect(screen.queryByText('9:41')).not.toBeInTheDocument();
    });
  });

  // ==================== BottomNav 测试 ====================
  describe('BottomNav', () => {
    it('showBottomNav=false 隐藏底部导航', () => {
      render(
        <MobileLayout showBottomNav={false}>
          内容
        </MobileLayout>
      );
      expect(screen.queryByText('任务')).not.toBeInTheDocument();
    });
  });

  // ==================== 内容区域测试 ====================
  describe('内容区域', () => {
    it('showBottomNav=true 时内容区域有底部 padding', () => {
      const { container } = render(
        <MobileLayout showBottomNav={true}>
          内容
        </MobileLayout>
      );
      const main = container.querySelector('main');
      expect(main).toHaveClass('pb-[80px]');
    });

    it('showBottomNav=false 时内容区域无底部 padding', () => {
      const { container } = render(
        <MobileLayout showBottomNav={false}>内容</MobileLayout>
      );
      const main = container.querySelector('main');
      expect(main).not.toHaveClass('pb-[95px]');
    });
  });

  // ==================== 样式测试 ====================
  describe('样式', () => {
    it('应用背景色', () => {
      const { container } = render(<MobileLayout>内容</MobileLayout>);
      expect(container.firstChild).toHaveClass('bg-bg-page');
    });

    it('支持自定义 className', () => {
      const { container } = render(
        <MobileLayout className="custom-layout">内容</MobileLayout>
      );
      expect(container.firstChild).toHaveClass('custom-layout');
    });
  });
});
