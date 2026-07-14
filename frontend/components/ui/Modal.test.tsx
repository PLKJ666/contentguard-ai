/**
 * Modal 组件测试
 * 测试覆盖: Modal, ConfirmModal, 副作用（ESC、overflow）
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Modal, ConfirmModal } from './Modal';

describe('Modal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    document.body.style.overflow = '';
  });

  afterEach(() => {
    // 确保副作用被清理
    document.body.style.overflow = '';
  });

  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('isOpen=true 时渲染内容', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose}>
          <p>模态框内容</p>
        </Modal>
      );
      expect(screen.getByText('模态框内容')).toBeInTheDocument();
    });

    it('isOpen=false 时不渲染', () => {
      render(
        <Modal isOpen={false} onClose={mockOnClose}>
          <p>模态框内容</p>
        </Modal>
      );
      expect(screen.queryByText('模态框内容')).not.toBeInTheDocument();
    });

    it('渲染标题', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} title="弹窗标题">
          内容
        </Modal>
      );
      expect(screen.getByText('弹窗标题')).toBeInTheDocument();
    });

    it('渲染页脚', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} footer={<button>确定</button>}>
          内容
        </Modal>
      );
      expect(screen.getByText('确定')).toBeInTheDocument();
    });
  });

  // ==================== 关闭按钮测试 ====================
  describe('关闭按钮', () => {
    it('默认显示关闭按钮', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} title="标题">
          内容
        </Modal>
      );
      // 使用 aria-label 精确选择关闭按钮
      expect(screen.getByLabelText('关闭')).toBeInTheDocument();
    });

    it('点击关闭按钮触发 onClose', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} title="标题">
          内容
        </Modal>
      );
      // 使用 aria-label 精确选择关闭按钮
      const closeButton = screen.getByLabelText('关闭');
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('showCloseButton=false 隐藏关闭按钮', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} title="标题" showCloseButton={false}>
          内容
        </Modal>
      );
      // 关闭按钮不存在
      expect(screen.queryByLabelText('关闭')).not.toBeInTheDocument();
    });
  });

  // ==================== 遮罩点击测试 ====================
  describe('遮罩点击', () => {
    it('点击遮罩默认关闭', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );
      const overlay = document.querySelector('.bg-black\\/60');
      fireEvent.click(overlay!);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('closeOnOverlay=false 禁用遮罩点击关闭', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} closeOnOverlay={false}>
          内容
        </Modal>
      );
      const overlay = document.querySelector('.bg-black\\/60');
      fireEvent.click(overlay!);
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  // ==================== ESC 键测试 ====================
  describe('ESC 键关闭', () => {
    it('按 ESC 键默认关闭', async () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );

      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('closeOnEsc=false 禁用 ESC 关闭', async () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose} closeOnEsc={false}>
          内容
        </Modal>
      );

      await act(async () => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('其他按键不触发关闭', async () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );

      await act(async () => {
        fireEvent.keyDown(document, { key: 'Enter' });
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  // ==================== Body Overflow 副作用测试 ====================
  describe('Body overflow 副作用', () => {
    it('打开时锁定 body 滚动', () => {
      render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('关闭时解锁 body 滚动', () => {
      const { rerender } = render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <Modal isOpen={false} onClose={mockOnClose}>
          内容
        </Modal>
      );
      expect(document.body.style.overflow).toBe('');
    });

    it('卸载时清理 overflow', () => {
      const { unmount } = render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );
      expect(document.body.style.overflow).toBe('hidden');

      unmount();
      expect(document.body.style.overflow).toBe('');
    });
  });

  // ==================== Size 测试 ====================
  describe('Size 样式', () => {
    it('默认 md size', () => {
      const { container } = render(
        <Modal isOpen={true} onClose={mockOnClose}>
          内容
        </Modal>
      );
      expect(container.querySelector('.max-w-md')).toBeInTheDocument();
    });

    it('sm size', () => {
      const { container } = render(
        <Modal isOpen={true} onClose={mockOnClose} size="sm">
          内容
        </Modal>
      );
      expect(container.querySelector('.max-w-sm')).toBeInTheDocument();
    });

    it('lg size', () => {
      const { container } = render(
        <Modal isOpen={true} onClose={mockOnClose} size="lg">
          内容
        </Modal>
      );
      expect(container.querySelector('.max-w-lg')).toBeInTheDocument();
    });

    it('xl size', () => {
      const { container } = render(
        <Modal isOpen={true} onClose={mockOnClose} size="xl">
          内容
        </Modal>
      );
      expect(container.querySelector('.max-w-xl')).toBeInTheDocument();
    });
  });

  // ==================== ClassName 测试 ====================
  describe('ClassName', () => {
    it('支持自定义 className', () => {
      const { container } = render(
        <Modal isOpen={true} onClose={mockOnClose} className="custom-modal">
          内容
        </Modal>
      );
      expect(container.querySelector('.custom-modal')).toBeInTheDocument();
    });
  });
});

describe('ConfirmModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnConfirm.mockClear();
  });

  // ==================== 基础渲染测试 ====================
  describe('基础渲染', () => {
    it('渲染标题和消息', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="确认删除"
          message="确定要删除吗？"
        />
      );
      expect(screen.getByText('确认删除')).toBeInTheDocument();
      expect(screen.getByText('确定要删除吗？')).toBeInTheDocument();
    });

    it('渲染确认和取消按钮', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="操作确认"
          message="消息"
          confirmText="确定"
        />
      );
      // Modal 有关闭按钮(X)，ConfirmModal 有确认和取消按钮，共 3 个
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('确定')).toBeInTheDocument();
      expect(screen.getByText('取消')).toBeInTheDocument();
    });
  });

  // ==================== 按钮文本自定义测试 ====================
  describe('按钮文本自定义', () => {
    it('支持自定义确认按钮文本', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="确认"
          message="消息"
          confirmText="删除"
        />
      );
      expect(screen.getByText('删除')).toBeInTheDocument();
    });

    it('支持自定义取消按钮文本', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="确认"
          message="消息"
          cancelText="返回"
        />
      );
      expect(screen.getByText('返回')).toBeInTheDocument();
    });
  });

  // ==================== 事件处理测试 ====================
  describe('事件处理', () => {
    it('点击确认按钮触发 onConfirm', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="操作确认"
          message="消息"
          confirmText="确定"
        />
      );
      fireEvent.click(screen.getByText('确定'));
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });

    it('点击取消按钮触发 onClose', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="操作确认"
          message="消息"
        />
      );
      fireEvent.click(screen.getByText('取消'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== Variant 测试 ====================
  describe('Variant 样式', () => {
    it('danger variant 使用红色确认按钮', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="确认删除"
          message="消息"
          variant="danger"
        />
      );
      const confirmButton = screen.getByText('确认').closest('button');
      expect(confirmButton).toHaveClass('bg-gradient-to-b', 'from-accent-coral');
    });
  });

  // ==================== Loading 测试 ====================
  describe('Loading 状态', () => {
    it('loading 时确认按钮显示加载状态', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="操作确认"
          message="消息"
          confirmText="确定"
          loading={true}
        />
      );
      const confirmButton = screen.getByText('确定').closest('button');
      expect(confirmButton).toBeDisabled();
    });

    it('loading 时取消按钮也被禁用', () => {
      render(
        <ConfirmModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          title="操作确认"
          message="消息"
          loading={true}
        />
      );
      const cancelButton = screen.getByText('取消').closest('button');
      expect(cancelButton).toBeDisabled();
    });
  });
});
