/**
 * Select 组件测试
 * 测试覆盖: options, label, error, hint, placeholder, disabled, forwardRef
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { Select } from './Select';

const mockOptions = [
  { value: 'option1', label: '选项一' },
  { value: 'option2', label: '选项二' },
  { value: 'option3', label: '选项三', disabled: true },
];

describe('Select', () => {
  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染下拉选择框', () => {
      render(<Select options={mockOptions} />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('渲染所有选项', () => {
      render(<Select options={mockOptions} />);
      expect(screen.getByText('选项一')).toBeInTheDocument();
      expect(screen.getByText('选项二')).toBeInTheDocument();
      expect(screen.getByText('选项三')).toBeInTheDocument();
    });

    it('渲染下拉箭头图标', () => {
      render(<Select options={mockOptions} data-testid="select" />);
      const wrapper = screen.getByTestId('select').closest('div');
      expect(wrapper?.querySelector('svg')).toBeInTheDocument();
    });
  });

  // ==================== Placeholder 测试 ====================
  describe('Placeholder', () => {
    it('显示 placeholder 选项', () => {
      render(<Select options={mockOptions} placeholder="请选择" />);
      expect(screen.getByText('请选择')).toBeInTheDocument();
    });

    it('placeholder 选项禁用', () => {
      render(<Select options={mockOptions} placeholder="请选择" />);
      const placeholderOption = screen.getByText('请选择');
      expect(placeholderOption).toHaveAttribute('disabled');
    });
  });

  // ==================== Label 测试 ====================
  describe('Label', () => {
    it('渲染 label', () => {
      render(<Select options={mockOptions} label="选择类型" />);
      expect(screen.getByText('选择类型')).toBeInTheDocument();
    });

    it('label 使用正确样式', () => {
      render(<Select options={mockOptions} label="类型" />);
      const label = screen.getByText('类型');
      expect(label).toHaveClass('text-caption', 'text-text-secondary');
    });
  });

  // ==================== Error 测试 ====================
  describe('Error 状态', () => {
    it('显示错误信息', () => {
      render(<Select options={mockOptions} error="请选择一个选项" />);
      expect(screen.getByText('请选择一个选项')).toBeInTheDocument();
    });

    it('错误信息使用红色', () => {
      render(<Select options={mockOptions} error="错误" />);
      expect(screen.getByText('错误')).toHaveClass('text-accent-coral');
    });

    it('错误状态边框变红', () => {
      render(<Select options={mockOptions} error="错误" data-testid="select" />);
      expect(screen.getByTestId('select')).toHaveClass('border-accent-coral');
    });
  });

  // ==================== Hint 测试 ====================
  describe('Hint 提示', () => {
    it('显示提示信息', () => {
      render(<Select options={mockOptions} hint="选择您的偏好" />);
      expect(screen.getByText('选择您的偏好')).toBeInTheDocument();
    });

    it('有 error 时不显示 hint', () => {
      render(<Select options={mockOptions} hint="提示" error="错误" />);
      expect(screen.queryByText('提示')).not.toBeInTheDocument();
      expect(screen.getByText('错误')).toBeInTheDocument();
    });
  });

  // ==================== Disabled 测试 ====================
  describe('Disabled 状态', () => {
    it('disabled 禁用选择框', () => {
      render(<Select options={mockOptions} disabled data-testid="select" />);
      expect(screen.getByTestId('select')).toBeDisabled();
    });

    it('选项可以单独禁用', () => {
      render(<Select options={mockOptions} />);
      const disabledOption = screen.getByText('选项三');
      expect(disabledOption).toHaveAttribute('disabled');
    });
  });

  // ==================== FullWidth 测试 ====================
  describe('FullWidth 属性', () => {
    it('默认全宽', () => {
      render(<Select options={mockOptions} data-testid="select" />);
      const wrapper = screen.getByTestId('select').closest('div')?.parentElement;
      expect(wrapper).toHaveClass('w-full');
    });

    it('fullWidth=false 不应用全宽', () => {
      render(<Select options={mockOptions} fullWidth={false} data-testid="select" />);
      const wrapper = screen.getByTestId('select').closest('div')?.parentElement;
      expect(wrapper).not.toHaveClass('w-full');
    });
  });

  // ==================== ForwardRef 测试 ====================
  describe('ForwardRef', () => {
    it('正确转发 ref', () => {
      const TestComponent = () => {
        const selectRef = useRef<HTMLSelectElement>(null);
        return (
          <>
            <Select ref={selectRef} options={mockOptions} data-testid="select" />
            <button onClick={() => selectRef.current?.focus()}>Focus</button>
          </>
        );
      };

      render(<TestComponent />);
      fireEvent.click(screen.getByText('Focus'));
      expect(screen.getByTestId('select')).toHaveFocus();
    });
  });

  // ==================== 事件处理测试 ====================
  describe('事件处理', () => {
    it('onChange 事件正常触发', () => {
      const handleChange = vi.fn();
      render(<Select options={mockOptions} onChange={handleChange} data-testid="select" />);
      fireEvent.change(screen.getByTestId('select'), { target: { value: 'option2' } });
      expect(handleChange).toHaveBeenCalled();
    });

    it('选择值正确更新', () => {
      render(<Select options={mockOptions} data-testid="select" />);
      const select = screen.getByTestId('select');
      fireEvent.change(select, { target: { value: 'option2' } });
      expect(select).toHaveValue('option2');
    });
  });

  // ==================== 自定义属性测试 ====================
  describe('自定义属性', () => {
    it('支持自定义 className', () => {
      render(<Select options={mockOptions} className="custom-select" data-testid="select" />);
      expect(screen.getByTestId('select')).toHaveClass('custom-select');
    });
  });
});
