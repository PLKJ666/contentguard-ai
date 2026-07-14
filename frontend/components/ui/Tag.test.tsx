/**
 * Tag 组件测试
 * 测试覆盖: Tag, SuccessTag, PendingTag, WarningTag, ErrorTag
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Star } from 'lucide-react';
import { Tag, SuccessTag, PendingTag, WarningTag, ErrorTag } from './Tag';

describe('Tag', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染标签文本', () => {
      render(<Tag status="success">通过</Tag>);
      expect(screen.getByText('通过')).toBeInTheDocument();
    });

    it('默认显示图标', () => {
      render(<Tag status="success">成功</Tag>);
      const tag = screen.getByText('成功').closest('span');
      expect(tag?.querySelector('svg')).toBeInTheDocument();
    });
  });

  // ==================== Status 样式测试 ====================
  describe('Status 样式', () => {
    it('success 状态应用绿色样式', () => {
      render(<Tag status="success">成功</Tag>);
      const tag = screen.getByText('成功').closest('span');
      expect(tag).toHaveClass('bg-accent-green/10', 'text-accent-green');
    });

    it('pending 状态应用蓝色样式', () => {
      render(<Tag status="pending">待处理</Tag>);
      const tag = screen.getByText('待处理').closest('span');
      expect(tag).toHaveClass('bg-accent-indigo/10', 'text-accent-indigo');
    });

    it('warning 状态应用黄色样式', () => {
      render(<Tag status="warning">警告</Tag>);
      const tag = screen.getByText('警告').closest('span');
      expect(tag).toHaveClass('bg-accent-amber/10', 'text-accent-amber');
    });

    it('error 状态应用红色样式', () => {
      render(<Tag status="error">错误</Tag>);
      const tag = screen.getByText('错误').closest('span');
      expect(tag).toHaveClass('bg-accent-coral/10', 'text-accent-coral');
    });
  });

  // ==================== Size 测试 ====================
  describe('Size 样式', () => {
    it('sm size 应用小尺寸样式', () => {
      render(<Tag status="success" size="sm">小标签</Tag>);
      const tag = screen.getByText('小标签').closest('span');
      expect(tag).toHaveClass('px-2', 'py-0.5', 'text-[10px]');
    });

    it('md size 应用中等尺寸样式（默认）', () => {
      render(<Tag status="success" size="md">中标签</Tag>);
      const tag = screen.getByText('中标签').closest('span');
      expect(tag).toHaveClass('px-2.5', 'py-1', 'text-[12px]');
    });

    it('默认使用 md size', () => {
      render(<Tag status="success">默认</Tag>);
      const tag = screen.getByText('默认').closest('span');
      expect(tag).toHaveClass('px-2.5', 'py-1');
    });
  });

  // ==================== Icon 测试 ====================
  describe('Icon 渲染', () => {
    it('默认显示状态对应的图标', () => {
      render(<Tag status="success">成功</Tag>);
      const tag = screen.getByText('成功').closest('span');
      expect(tag?.querySelector('svg')).toBeInTheDocument();
    });

    it('icon={false} 隐藏图标', () => {
      render(<Tag status="success" icon={false}>无图标</Tag>);
      const tag = screen.getByText('无图标').closest('span');
      expect(tag?.querySelector('svg')).not.toBeInTheDocument();
    });

    it('icon={true} 显示默认图标', () => {
      render(<Tag status="success" icon={true}>有图标</Tag>);
      const tag = screen.getByText('有图标').closest('span');
      expect(tag?.querySelector('svg')).toBeInTheDocument();
    });

    it('支持自定义图标', () => {
      render(<Tag status="success" icon={Star}>自定义</Tag>);
      const tag = screen.getByText('自定义').closest('span');
      expect(tag?.querySelector('svg')).toBeInTheDocument();
    });
  });

  // ==================== 自定义 className 测试 ====================
  describe('自定义 className', () => {
    it('支持自定义 className', () => {
      render(<Tag status="success" className="custom-tag">自定义</Tag>);
      const tag = screen.getByText('自定义').closest('span');
      expect(tag).toHaveClass('custom-tag');
    });
  });
});

// ==================== 预定义标签组件测试 ====================
describe('SuccessTag', () => {
  it('渲染 success 状态', () => {
    render(<SuccessTag>通过</SuccessTag>);
    const tag = screen.getByText('通过').closest('span');
    expect(tag).toHaveClass('bg-accent-green/10', 'text-accent-green');
  });

  it('支持 size 属性', () => {
    render(<SuccessTag size="sm">小</SuccessTag>);
    const tag = screen.getByText('小').closest('span');
    expect(tag).toHaveClass('px-2', 'py-0.5');
  });
});

describe('PendingTag', () => {
  it('渲染 pending 状态', () => {
    render(<PendingTag>处理中</PendingTag>);
    const tag = screen.getByText('处理中').closest('span');
    expect(tag).toHaveClass('bg-accent-indigo/10', 'text-accent-indigo');
  });

  it('支持 size 属性', () => {
    render(<PendingTag size="sm">小</PendingTag>);
    const tag = screen.getByText('小').closest('span');
    expect(tag).toHaveClass('px-2', 'py-0.5');
  });
});

describe('WarningTag', () => {
  it('渲染 warning 状态', () => {
    render(<WarningTag>注意</WarningTag>);
    const tag = screen.getByText('注意').closest('span');
    expect(tag).toHaveClass('bg-accent-amber/10', 'text-accent-amber');
  });

  it('支持 size 属性', () => {
    render(<WarningTag size="sm">小</WarningTag>);
    const tag = screen.getByText('小').closest('span');
    expect(tag).toHaveClass('px-2', 'py-0.5');
  });
});

describe('ErrorTag', () => {
  it('渲染 error 状态', () => {
    render(<ErrorTag>失败</ErrorTag>);
    const tag = screen.getByText('失败').closest('span');
    expect(tag).toHaveClass('bg-accent-coral/10', 'text-accent-coral');
  });

  it('支持 size 属性', () => {
    render(<ErrorTag size="sm">小</ErrorTag>);
    const tag = screen.getByText('小').closest('span');
    expect(tag).toHaveClass('px-2', 'py-0.5');
  });
});
