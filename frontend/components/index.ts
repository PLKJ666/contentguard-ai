/**
 * ContentGuard AI component library exports
 * 基于 UIDesignSpec.md 设计规范
 */

// UI 基础组件
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './ui/Button';
export { Card, CardHeader, CardTitle, CardContent, CardFooter, type CardProps } from './ui/Card';
export { Tag, SuccessTag, PendingTag, WarningTag, ErrorTag, type TagProps, type TagStatus } from './ui/Tag';
export { Input, SearchInput, PasswordInput, type InputProps } from './ui/Input';
export { Select, type SelectProps, type SelectOption } from './ui/Select';
export { ProgressBar, CircularProgress, type ProgressBarProps, type CircularProgressProps } from './ui/ProgressBar';
export { Modal, ConfirmModal, type ModalProps, type ConfirmModalProps } from './ui/Modal';
export {
  FilePreview,
  FileInfoCard,
  FilePreviewModal,
  VideoPlayer,
  ImageViewer,
  PDFViewer,
  DocumentPlaceholder,
  getFileCategory,
  type FileInfo
} from './ui/FilePreview';
export { ToastProvider, useToast } from './ui/Toast';

// 导航组件
export { BottomNav } from './navigation/BottomNav';
export { Sidebar } from './navigation/Sidebar';
export { StatusBar } from './navigation/StatusBar';

// 布局组件
export { MobileLayout } from './layout/MobileLayout';
export { DesktopLayout } from './layout/DesktopLayout';
export { ResponsiveLayout } from './layout/ResponsiveLayout';
