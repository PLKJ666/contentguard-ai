/**
 * StatusBar 组件测试
 * 测试覆盖: 时间显示、状态图标、自定义样式
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染状态栏', () => {
      const { container } = render(<StatusBar />);
      expect(container.firstChild).toBeInTheDocument();
    });

    it('默认显示时间 9:41', () => {
      render(<StatusBar />);
      expect(screen.getByText('9:41')).toBeInTheDocument();
    });

    it('渲染状态图标（信号、WiFi、电池）', () => {
      const { container } = render(<StatusBar />);
      const icons = container.querySelectorAll('svg');
      expect(icons).toHaveLength(3);
    });
  });

  // ==================== Time 属性测试 ====================
  describe('Time 属性', () => {
    it('支持自定义时间', () => {
      render(<StatusBar time="10:30" />);
      expect(screen.getByText('10:30')).toBeInTheDocument();
    });

    it('时间使用正确样式', () => {
      render(<StatusBar time="12:00" />);
      const timeElement = screen.getByText('12:00');
      expect(timeElement).toHaveClass('text-text-primary', 'font-semibold', 'text-[17px]');
    });
  });

  // ==================== 样式测试 ====================
  describe('样式', () => {
    it('应用固定高度', () => {
      const { container } = render(<StatusBar />);
      expect(container.firstChild).toHaveClass('h-[44px]');
    });

    it('支持自定义 className', () => {
      const { container } = render(<StatusBar className="custom-status" />);
      expect(container.firstChild).toHaveClass('custom-status');
    });
  });
});
