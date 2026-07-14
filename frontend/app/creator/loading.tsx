export default function CreatorLoading() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-border-subtle border-t-accent-indigo rounded-full animate-spin" />
        <p className="text-text-tertiary text-sm">加载中...</p>
      </div>
    </div>
  )
}
