import '../styles/globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { SSEProvider } from '@/contexts/SSEContext'
import { ToastProvider } from '@/components/ui/Toast'
import { ThemeProvider } from '@/components/ThemeProvider'

export const metadata = {
  title: 'ContentGuard AI',
  description: 'AI 驱动的营销内容合规审核平台',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="h-full bg-bg-page text-text-primary font-sans">
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <SSEProvider>{children}</SSEProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
