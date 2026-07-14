/**
 * Card 组件测试
 * 测试覆盖: Card, CardHeader, CardTitle, CardContent, CardFooter
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './Card';

describe('Card', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染子元素', () => {
      render(<Card>卡片内容</Card>);
      expect(screen.getByText('卡片内容')).toBeInTheDocument();
    });

    it('默认使用 default variant 和 mobile padding', () => {
      render(<Card data-testid="card">内容</Card>);
      const card = screen.getByTestId('card');
      expect(card).toHaveClass('bg-bg-card', 'rounded-card');
    });
  });

  // ==================== Variant 测试 ====================
  describe('Variant 样式', () => {
    it('default variant 应用基础样式', () => {
      render(<Card variant="default">Default</Card>);
      const card = screen.getByText('Default').closest('div');
      expect(card).toHaveClass('bg-bg-card');
      expect(card).not.toHaveClass('shadow-elevated');
    });

    it('elevated variant 应用阴影样式', () => {
      render(<Card variant="elevated">Elevated</Card>);
      const card = screen.getByText('Elevated').closest('div');
      expect(card).toHaveClass('bg-bg-elevated', 'shadow-elevated');
    });
  });

  // ==================== Padding 测试 ====================
  describe('Padding 样式', () => {
    it('mobile padding 应用正确样式', () => {
      render(<Card padding="mobile">Mobile</Card>);
      const card = screen.getByText('Mobile').closest('div');
      expect(card).toHaveClass('p-[14px_16px]');
    });

    it('desktop padding 应用正确样式', () => {
      render(<Card padding="desktop">Desktop</Card>);
      const card = screen.getByText('Desktop').closest('div');
      expect(card).toHaveClass('p-[16px_20px]');
    });

    it('none padding 应用正确样式', () => {
      render(<Card padding="none">No Padding</Card>);
      const card = screen.getByText('No Padding').closest('div');
      expect(card).toHaveClass('p-0');
    });
  });

  // ==================== Hoverable 测试 ====================
  describe('Hoverable 属性', () => {
    it('hoverable 应用 hover 样式', () => {
      render(<Card hoverable>Hoverable</Card>);
      const card = screen.getByText('Hoverable').closest('div');
      expect(card).toHaveClass('cursor-pointer', 'transition-all');
    });

    it('非 hoverable 不应用 hover 样式', () => {
      render(<Card>Not Hoverable</Card>);
      const card = screen.getByText('Not Hoverable').closest('div');
      expect(card).not.toHaveClass('hover:bg-bg-elevated');
    });
  });

  // ==================== onClick 测试 ====================
  describe('onClick 事件', () => {
    it('点击触发 onClick', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Clickable</Card>);
      fireEvent.click(screen.getByText('Clickable'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('有 onClick 时显示 pointer 样式', () => {
      const handleClick = vi.fn();
      render(<Card onClick={handleClick}>Clickable</Card>);
      const card = screen.getByText('Clickable').closest('div');
      expect(card).toHaveClass('cursor-pointer');
    });
  });

  // ==================== 自定义 className 测试 ====================
  describe('自定义 className', () => {
    it('支持自定义 className', () => {
      render(<Card className="custom-card">Custom</Card>);
      const card = screen.getByText('Custom').closest('div');
      expect(card).toHaveClass('custom-card');
    });
  });
});

describe('CardHeader', () => {
  it('渲染子元素', () => {
    render(<CardHeader>头部内容</CardHeader>);
    expect(screen.getByText('头部内容')).toBeInTheDocument();
  });

  it('应用 flex 布局', () => {
    render(<CardHeader>Header</CardHeader>);
    const header = screen.getByText('Header').closest('div');
    expect(header).toHaveClass('flex', 'items-center', 'justify-between');
  });

  it('支持自定义 className', () => {
    render(<CardHeader className="custom-header">Header</CardHeader>);
    const header = screen.getByText('Header').closest('div');
    expect(header).toHaveClass('custom-header');
  });
});

describe('CardTitle', () => {
  it('渲染为 h3 标签', () => {
    render(<CardTitle>标题</CardTitle>);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('标题');
  });

  it('应用标题样式', () => {
    render(<CardTitle>Title</CardTitle>);
    const title = screen.getByRole('heading');
    expect(title).toHaveClass('text-base', 'text-text-primary', 'font-medium', 'tracking-tight');
  });

  it('支持自定义 className', () => {
    render(<CardTitle className="custom-title">Title</CardTitle>);
    expect(screen.getByRole('heading')).toHaveClass('custom-title');
  });
});

describe('CardContent', () => {
  it('渲染子元素', () => {
    render(<CardContent>内容区域</CardContent>);
    expect(screen.getByText('内容区域')).toBeInTheDocument();
  });

  it('支持自定义 className', () => {
    render(<CardContent className="custom-content">Content</CardContent>);
    const content = screen.getByText('Content').closest('div');
    expect(content).toHaveClass('custom-content');
  });
});

describe('CardFooter', () => {
  it('渲染子元素', () => {
    render(<CardFooter>页脚内容</CardFooter>);
    expect(screen.getByText('页脚内容')).toBeInTheDocument();
  });

  it('应用边框和间距样式', () => {
    render(<CardFooter>Footer</CardFooter>);
    const footer = screen.getByText('Footer').closest('div');
    expect(footer).toHaveClass('mt-4', 'pt-4', 'border-t', 'border-border-subtle');
  });

  it('支持自定义 className', () => {
    render(<CardFooter className="custom-footer">Footer</CardFooter>);
    const footer = screen.getByText('Footer').closest('div');
    expect(footer).toHaveClass('custom-footer');
  });
});

describe('Card 组合使用', () => {
  it('完整卡片结构渲染正确', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>卡片标题</CardTitle>
        </CardHeader>
        <CardContent>卡片内容</CardContent>
        <CardFooter>卡片页脚</CardFooter>
      </Card>
    );

    expect(screen.getByRole('heading', { name: '卡片标题' })).toBeInTheDocument();
    expect(screen.getByText('卡片内容')).toBeInTheDocument();
    expect(screen.getByText('卡片页脚')).toBeInTheDocument();
  });
});
