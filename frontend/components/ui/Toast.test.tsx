import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function ToastConsumer() {
  const toast = useToast();
  const firstToastRef = (globalThis as any).__toastRef;

  if (!firstToastRef) {
    (globalThis as any).__toastRef = toast;
  }

  return (
    <div>
      <button type="button" onClick={() => toast.error('加载失败', 0)}>
        触发 Toast
      </button>
      <div data-testid="same-ref">
        {String((globalThis as any).__toastRef === toast)}
      </div>
    </div>
  );
}

describe('ToastProvider', () => {
  it('弹出 toast 后保持 hook 返回值稳定', () => {
    delete (globalThis as any).__toastRef;

    render(
      <ToastProvider>
        <ToastConsumer />
      </ToastProvider>
    );

    expect(screen.getByTestId('same-ref')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: '触发 Toast' }));

    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByTestId('same-ref')).toHaveTextContent('true');

    delete (globalThis as any).__toastRef;
  });
});
