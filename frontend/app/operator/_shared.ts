import type { TaskStage } from '@/types/task'

export const 平台选项 = [
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'bilibili', label: 'B站' },
  { value: 'kuaishou', label: '快手' },
  { value: 'weibo', label: '微博' },
  { value: 'wechat', label: '微信视频号' },
]

export const 平台名称映射: Record<string, string> = 平台选项.reduce(
  (acc, item) => ({ ...acc, [item.value]: item.label }),
  {} as Record<string, string>
)

export const 阶段名称映射: Record<TaskStage, string> = {
  script_upload: '待上传脚本',
  script_ai_review: '脚本 AI 审核中',
  script_agency_review: '待处理脚本审核',
  script_brand_review: '待品牌终审',
  video_upload: '待上传视频',
  video_ai_review: '视频 AI 审核中',
  video_agency_review: '待处理视频审核',
  video_brand_review: '待品牌终审',
  completed: '已完成',
  rejected: '已驳回',
}

export function 获取阶段名称(stage?: TaskStage | string | null): string {
  if (!stage) return '未知阶段'
  return 阶段名称映射[stage as TaskStage] || stage
}

export function 是否为AI处理中(stage?: TaskStage | string | null): boolean {
  return stage === 'script_ai_review' || stage === 'video_ai_review'
}

export function 获取代运营任务入口(taskId: string, stage?: TaskStage | string | null): string {
  if (stage === 'script_agency_review') {
    return `/operator/review/script/${encodeURIComponent(taskId)}`
  }
  if (stage === 'video_agency_review') {
    return `/operator/review/video/${encodeURIComponent(taskId)}`
  }
  return `/operator/tasks/${encodeURIComponent(taskId)}`
}

export function 格式化时间(value?: string | null): string {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function 下载二进制文件(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
