/**
 * Input 组件测试
 * 测试覆盖: Input, SearchInput, PasswordInput
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { Mail, Lock } from 'lucide-react';
import { Input, SearchInput, PasswordInput } from './Input';

describe('Input', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染输入框', () => {
      render(<Input placeholder="请输入" />);
      expect(screen.getByPlaceholderText('请输入')).toBeInTheDocument();
    });

    it('默认全宽', () => {
      render(<Input data-testid="input" />);
      const wrapper = screen.getByTestId('input').closest('div')?.parentElement;
      expect(wrapper).toHaveClass('w-full');
    });
  });

  // ==================== Label 测试 ====================
  describe('Label', () => {
    it('渲染 label', () => {
      render(<Input label="邮箱" />);
      expect(screen.getByText('邮箱')).toBeInTheDocument();
    });

    it('label 使用正确样式', () => {
      render(<Input label="用户名" />);
      const label = screen.getByText('用户名');
      expect(label).toHaveClass('text-caption', 'text-text-secondary');
    });
  });

  // ==================== Error 测试 ====================
  describe('Error 状态', () => {
    it('显示错误信息', () => {
      render(<Input error="邮箱格式不正确" />);
      expect(screen.getByText('邮箱格式不正确')).toBeInTheDocument();
    });

    it('错误信息使用红色', () => {
      render(<Input error="错误" />);
      const errorText = screen.getByText('错误');
      expect(errorText).toHaveClass('text-accent-coral');
    });

    it('错误状态输入框边框变红', () => {
      render(<Input error="错误" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toHaveClass('border-accent-coral');
    });
  });

  // ==================== Hint 测试 ====================
  describe('Hint 提示', () => {
    it('显示提示信息', () => {
      render(<Input hint="请输入有效邮箱" />);
      expect(screen.getByText('请输入有效邮箱')).toBeInTheDocument();
    });

    it('有 error 时不显示 hint', () => {
      render(<Input hint="提示" error="错误" />);
      expect(screen.queryByText('提示')).not.toBeInTheDocument();
      expect(screen.getByText('错误')).toBeInTheDocument();
    });
  });

  // ==================== Icon 测试 ====================
  describe('Icon 渲染', () => {
    it('渲染左侧图标', () => {
      render(<Input leftIcon={Mail} data-testid="input" />);
      const wrapper = screen.getByTestId('input').closest('div');
      expect(wrapper?.querySelector('svg')).toBeInTheDocument();
    });

    it('左侧图标增加左内边距', () => {
      render(<Input leftIcon={Mail} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pl-10');
    });

    it('渲染右侧图标', () => {
      render(<Input rightIcon={Lock} data-testid="input" />);
      const wrapper = screen.getByTestId('input').closest('div');
      expect(wrapper?.querySelector('button')).toBeInTheDocument();
    });

    it('右侧图标增加右内边距', () => {
      render(<Input rightIcon={Lock} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pr-10');
    });

    it('点击右侧图标触发回调', () => {
      const handleClick = vi.fn();
      render(<Input rightIcon={Lock} onRightIconClick={handleClick} />);
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== Disabled 测试 ====================
  describe('Disabled 状态', () => {
    it('disabled 禁用输入框', () => {
      render(<Input disabled data-testid="input" />);
      const input = screen.getByTestId('input');
      // 验证 disabled 属性
      expect(input).toBeDisabled();
      // 验证 disabled 时不可编辑
      expect(input).toHaveAttribute('disabled');
    });

    it('非 disabled 输入框可编辑', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).not.toBeDisabled();
      expect(input).not.toHaveAttribute('disabled');
    });
  });

  // ==================== FullWidth 测试 ====================
  describe('FullWidth 属性', () => {
    it('fullWidth=false 不应用全宽', () => {
      render(<Input fullWidth={false} data-testid="input" />);
      const wrapper = screen.getByTestId('input').closest('div')?.parentElement;
      expect(wrapper).not.toHaveClass('w-full');
    });
  });

  // ==================== ForwardRef 测试 ====================
  describe('ForwardRef', () => {
    it('正确转发 ref', () => {
      const TestComponent = () => {
        const inputRef = useRef<HTMLInputElement>(null);
        return (
          <>
            <Input ref={inputRef} data-testid="input" />
            <button onClick={() => inputRef.current?.focus()}>Focus</button>
          </>
        );
      };

      render(<TestComponent />);
      fireEvent.click(screen.getByText('Focus'));
      expect(screen.getByTestId('input')).toHaveFocus();
    });
  });

  // ==================== 事件处理测试 ====================
  describe('事件处理', () => {
    it('onChange 事件正常触发', () => {
      const handleChange = vi.fn();
      render(<Input onChange={handleChange} data-testid="input" />);
      fireEvent.change(screen.getByTestId('input'), { target: { value: 'test' } });
      expect(handleChange).toHaveBeenCalled();
    });

    it('输入值正确更新', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      fireEvent.change(input, { target: { value: 'hello' } });
      expect(input).toHaveValue('hello');
    });
  });
});

describe('SearchInput', () => {
  it('渲染搜索图标', () => {
    render(<SearchInput data-testid="search" />);
    const wrapper = screen.getByTestId('search').closest('div');
    expect(wrapper?.querySelector('svg')).toBeInTheDocument();
  });

  it('默认 placeholder 为搜索...', () => {
    render(<SearchInput />);
    expect(screen.getByPlaceholderText('搜索...')).toBeInTheDocument();
  });

  it('支持自定义 placeholder', () => {
    render(<SearchInput placeholder="搜索用户" />);
    expect(screen.getByPlaceholderText('搜索用户')).toBeInTheDocument();
  });

  it('正确转发 ref', () => {
    const TestComponent = () => {
      const inputRef = useRef<HTMLInputElement>(null);
      return (
        <>
          <SearchInput ref={inputRef} data-testid="search" />
          <button onClick={() => inputRef.current?.focus()}>Focus</button>
        </>
      );
    };

    render(<TestComponent />);
    fireEvent.click(screen.getByText('Focus'));
    expect(screen.getByTestId('search')).toHaveFocus();
  });
});

describe('PasswordInput', () => {
  it('默认隐藏密码', () => {
    render(<PasswordInput data-testid="password" />);
    expect(screen.getByTestId('password')).toHaveAttribute('type', 'password');
  });

  it('点击图标切换密码可见性', () => {
    render(<PasswordInput data-testid="password" />);
    const input = screen.getByTestId('password');
    const toggleButton = screen.getByRole('button');

    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(toggleButton);
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(toggleButton);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('正确转发 ref', () => {
    const TestComponent = () => {
      const inputRef = useRef<HTMLInputElement>(null);
      return (
        <>
          <PasswordInput ref={inputRef} data-testid="password" />
          <button onClick={() => inputRef.current?.focus()}>Focus</button>
        </>
      );
    };

    render(<TestComponent />);
    fireEvent.click(screen.getByText('Focus'));
    expect(screen.getByTestId('password')).toHaveFocus();
  });
});
