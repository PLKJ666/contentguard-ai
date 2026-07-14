/**
 * ProgressBar 组件测试
 * 测试覆盖: ProgressBar, CircularProgress
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar, CircularProgress } from './ProgressBar';

describe('ProgressBar', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染进度条', () => {
      const { container } = render(<ProgressBar value={50} />);
      expect(container.querySelector('.bg-bg-elevated')).toBeInTheDocument();
    });

    it('正确计算进度百分比', () => {
      const { container } = render(<ProgressBar value={75} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '75%' });
    });
  });

  // ==================== Value 边界测试 ====================
  describe('Value 边界值', () => {
    it('0% 进度', () => {
      const { container } = render(<ProgressBar value={0} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '0%' });
    });

    it('100% 进度', () => {
      const { container } = render(<ProgressBar value={100} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '100%' });
    });

    it('超过 100% 限制为 100%', () => {
      const { container } = render(<ProgressBar value={150} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '100%' });
    });

    it('负值限制为 0%', () => {
      const { container } = render(<ProgressBar value={-10} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '0%' });
    });
  });

  // ==================== Max 测试 ====================
  describe('Max 属性', () => {
    it('自定义 max 值计算正确', () => {
      const { container } = render(<ProgressBar value={25} max={50} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '50%' }); // 25/50 = 50%
    });

    it('默认 max 为 100', () => {
      const { container } = render(<ProgressBar value={30} />);
      const progressFill = container.querySelector('.bg-accent-indigo');
      expect(progressFill).toHaveStyle({ width: '30%' });
    });
  });

  // ==================== ShowLabel 测试 ====================
  describe('ShowLabel 属性', () => {
    it('showLabel=true 显示标签', () => {
      render(<ProgressBar value={50} showLabel />);
      expect(screen.getByText('进度')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('showLabel=false 不显示标签（默认）', () => {
      render(<ProgressBar value={50} />);
      expect(screen.queryByText('进度')).not.toBeInTheDocument();
    });

    it('标签显示四舍五入的百分比', () => {
      render(<ProgressBar value={33.7} showLabel />);
      expect(screen.getByText('34%')).toBeInTheDocument();
    });
  });

  // ==================== Size 测试 ====================
  describe('Size 样式', () => {
    it('sm size', () => {
      const { container } = render(<ProgressBar value={50} size="sm" />);
      expect(container.querySelector('.h-1')).toBeInTheDocument();
    });

    it('md size（默认）', () => {
      const { container } = render(<ProgressBar value={50} size="md" />);
      expect(container.querySelector('.h-2')).toBeInTheDocument();
    });

    it('lg size', () => {
      const { container } = render(<ProgressBar value={50} size="lg" />);
      expect(container.querySelector('.h-3')).toBeInTheDocument();
    });
  });

  // ==================== Variant 测试 ====================
  describe('Variant 样式', () => {
    it('default variant（默认）', () => {
      const { container } = render(<ProgressBar value={50} />);
      expect(container.querySelector('.bg-accent-indigo')).toBeInTheDocument();
    });

    it('success variant', () => {
      const { container } = render(<ProgressBar value={50} variant="success" />);
      expect(container.querySelector('.bg-accent-green')).toBeInTheDocument();
    });

    it('warning variant', () => {
      const { container } = render(<ProgressBar value={50} variant="warning" />);
      expect(container.querySelector('.bg-accent-amber')).toBeInTheDocument();
    });

    it('error variant', () => {
      const { container } = render(<ProgressBar value={50} variant="error" />);
      expect(container.querySelector('.bg-accent-coral')).toBeInTheDocument();
    });
  });

  // ==================== ClassName 测试 ====================
  describe('ClassName', () => {
    it('支持自定义 className', () => {
      const { container } = render(<ProgressBar value={50} className="custom-progress" />);
      expect(container.firstChild).toHaveClass('custom-progress');
    });
  });
});

describe('CircularProgress', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染 SVG 环形进度', () => {
      const { container } = render(<CircularProgress value={50} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('渲染两个圆（背景和进度）', () => {
      const { container } = render(<CircularProgress value={50} />);
      const circles = container.querySelectorAll('circle');
      expect(circles).toHaveLength(2);
    });
  });

  // ==================== Value 测试 ====================
  describe('Value 边界值', () => {
    it('显示正确的百分比', () => {
      render(<CircularProgress value={75} />);
      expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('四舍五入百分比', () => {
      render(<CircularProgress value={33.6} />);
      expect(screen.getByText('34%')).toBeInTheDocument();
    });

    it('超过 100% 限制为 100%', () => {
      render(<CircularProgress value={150} />);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('负值限制为 0%', () => {
      render(<CircularProgress value={-10} />);
      expect(screen.getByText('0%')).toBeInTheDocument();
    });
  });

  // ==================== Size 测试 ====================
  describe('Size 属性', () => {
    it('默认 size 为 120', () => {
      const { container } = render(<CircularProgress value={50} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '120');
      expect(svg).toHaveAttribute('height', '120');
    });

    it('支持自定义 size', () => {
      const { container } = render(<CircularProgress value={50} size={80} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '80');
      expect(svg).toHaveAttribute('height', '80');
    });
  });

  // ==================== ShowLabel 测试 ====================
  describe('ShowLabel 属性', () => {
    it('showLabel=true 显示百分比（默认）', () => {
      render(<CircularProgress value={50} />);
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('showLabel=false 隐藏百分比', () => {
      render(<CircularProgress value={50} showLabel={false} />);
      expect(screen.queryByText('50%')).not.toBeInTheDocument();
    });
  });

  // ==================== Label 测试 ====================
  describe('Label 属性', () => {
    it('显示自定义 label', () => {
      render(<CircularProgress value={50} label="审核中" />);
      expect(screen.getByText('审核中')).toBeInTheDocument();
    });

    it('showLabel=false 时不显示 label', () => {
      render(<CircularProgress value={50} label="审核中" showLabel={false} />);
      expect(screen.queryByText('审核中')).not.toBeInTheDocument();
    });
  });

  // ==================== Variant 测试 ====================
  describe('Variant 样式', () => {
    it('default variant 使用正确颜色', () => {
      const { container } = render(<CircularProgress value={50} variant="default" />);
      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke', '#6366F1');
    });

    it('success variant 使用正确颜色', () => {
      const { container } = render(<CircularProgress value={50} variant="success" />);
      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke', '#32D583');
    });

    it('warning variant 使用正确颜色', () => {
      const { container } = render(<CircularProgress value={50} variant="warning" />);
      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke', '#F59E0B');
    });

    it('error variant 使用正确颜色', () => {
      const { container } = render(<CircularProgress value={50} variant="error" />);
      const progressCircle = container.querySelectorAll('circle')[1];
      expect(progressCircle).toHaveAttribute('stroke', '#E85A4F');
    });
  });

  // ==================== ClassName 测试 ====================
  describe('ClassName', () => {
    it('支持自定义 className', () => {
      const { container } = render(<CircularProgress value={50} className="custom-circular" />);
      expect(container.firstChild).toHaveClass('custom-circular');
    });
  });
});
