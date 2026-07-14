'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ChangelogData, ChangelogVersion, ChangelogEntry } from '@/types/changelog'
import changelogData from '@/data/changelog.json'

function TypeBadge({ type }: { type: ChangelogEntry['type'] }) {
  if (type === 'feat') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
        新功能
      </span>
    )
  }
  if (type === 'perf') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sky-500/15 text-sky-400 border border-sky-500/20 flex-shrink-0">
        性能优化
      </span>
    )
  }
  if (type === 'docs') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/15 text-slate-300 border border-slate-500/20 flex-shrink-0">
        文档
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20 flex-shrink-0">
      修复
    </span>
  )
}

function VersionCard({ version }: { version: ChangelogVersion }) {
  return (
    <div className="px-6 py-5 border-b border-border-subtle last:border-b-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-text-primary">{version.title}</h3>
        <span className="text-sm text-text-tertiary">{version.date}</span>
      </div>
      <div className="space-y-2.5">
        {version.entries.map((entry) => (
          <div key={entry.hash} className="flex items-start gap-3">
            <TypeBadge type={entry.type} />
            <span className="text-sm text-text-secondary leading-relaxed">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ChangelogContent() {
  const data = changelogData as ChangelogData
  const [expanded, setExpanded] = useState(true)

  const latestVersion = data.versions[0]

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* 标题区域 */}
      <div className="text-center">
        <h1 className="text-2xl lg:text-[28px] font-bold text-text-primary mb-3">ContentGuard AI</h1>
        {latestVersion?.tag && (
          <div className="mb-3">
            <span className="inline-flex px-3 py-1 rounded-full border border-accent-indigo text-accent-indigo text-sm font-medium">
              {latestVersion.tag}
            </span>
          </div>
        )}
        <p className="text-sm text-text-secondary">AI 营销内容合规审核系统</p>
      </div>

      {/* 产品信息卡 */}
      <div className="bg-bg-card border border-border-subtle rounded-2xl px-6">
        <div className="flex items-center justify-between py-4 border-b border-border-subtle">
          <span className="text-text-secondary text-sm">开发公司</span>
          <span className="text-text-primary text-sm font-medium">ContentGuard AI</span>
        </div>
        <div className="flex items-center justify-between py-4 border-b border-border-subtle">
          <span className="text-text-secondary text-sm">官方网站</span>
          <a
            href="https://github.com/PLKJ666/contentguard-ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-indigo text-sm hover:underline"
          >
            github.com/PLKJ666/contentguard-ai
          </a>
        </div>
        <div className="flex items-center justify-between py-4">
          <span className="text-text-secondary text-sm">运行环境</span>
          <span className="text-text-primary text-sm font-medium">production</span>
        </div>
      </div>

      {/* 技术栈 */}
      <div>
        <h2 className="text-sm text-text-secondary mb-3">技术栈</h2>
        <div className="flex flex-wrap gap-2">
          {['FastAPI', 'Next.js', 'PostgreSQL', 'Redis', 'TailwindCSS'].map((tech) => (
            <span
              key={tech}
              className="px-3 py-1.5 rounded-lg border border-border-subtle text-sm text-text-primary bg-bg-card"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>

      {/* 展开/收起按钮 */}
      <div className="flex justify-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors text-sm"
        >
          {expanded ? '收起更新日志' : '展开更新日志'}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* 更新日志列表 */}
      {expanded && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="bg-bg-card border border-border-subtle rounded-2xl overflow-hidden">
            {data.versions.length === 0 ? (
              <div className="text-center py-20 text-text-tertiary">暂无更新记录</div>
            ) : (
              data.versions.map((version) => (
                <VersionCard key={version.id} version={version} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
