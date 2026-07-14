import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-8xl font-bold text-accent-indigo mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-text-primary mb-2">
          页面未找到
        </h2>
        <p className="text-text-secondary mb-8">
          您访问的页面不存在或已被移除
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent-indigo text-white rounded-xl font-medium hover:bg-accent-indigo/90 transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  )
}
