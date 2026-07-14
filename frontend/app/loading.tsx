export default function Loading() {
  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-3 border-border-subtle border-t-accent-indigo rounded-full animate-spin" />
        <p className="text-text-tertiary text-sm">加载中...</p>
      </div>
    </div>
  )
}
