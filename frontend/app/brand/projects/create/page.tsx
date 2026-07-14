'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  ArrowLeft,
  Upload,
  Calendar,
  FileText,
  CheckCircle,
  AlertCircle,
  Search,
  Building2,
  Loader2,
  Trash2,
  RotateCcw
} from 'lucide-react'
import { api, extractErrorMessage } from '@/lib/api'
import { platformOptions } from '@/lib/platforms'
import type { AgencyDetail } from '@/types/organization'
import type { BriefAttachment } from '@/types/brief'

// 单个文件的上传状态
interface UploadFileItem {
  id: string
  name: string
  size: string
  rawSize: number
  status: 'uploading' | 'success' | 'error'
  progress: number
  url?: string
  error?: string
  file?: File // 保留引用用于重试
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB'
}

export default function CreateProjectPage() {
  const router = useRouter()
  const toast = useToast()

  const [projectName, setProjectName] = useState('')
  const [description, setDescription] = useState('')
  const [platform, setPlatform] = useState('douyin')
  const [deadline, setDeadline] = useState('')
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([])
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agencySearch, setAgencySearch] = useState('')
  const [agencies, setAgencies] = useState<AgencyDetail[]>([])
  const [loadingAgencies, setLoadingAgencies] = useState(true)

  // 从成功上传的文件中提取 BriefAttachment
  const briefFiles: BriefAttachment[] = uploadFiles
    .filter(f => f.status === 'success' && f.url)
    .map(f => ({ id: f.id, name: f.name, url: f.url!, size: f.size }))

  const hasUploading = uploadFiles.some(f => f.status === 'uploading')

  useEffect(() => {
    const loadAgencies = async () => {
      try {
        const data = await api.listBrandAgencies()
        setAgencies(data.items)
      } catch (err) {
        console.error('Failed to load agencies:', err)
        toast.error('加载代理商列表失败')
      } finally {
        setLoadingAgencies(false)
      }
    }
    loadAgencies()
  }, [toast])

  const filteredAgencies = agencies.filter(agency =>
    agencySearch === '' ||
    agency.name.toLowerCase().includes(agencySearch.toLowerCase()) ||
    agency.id.toLowerCase().includes(agencySearch.toLowerCase())
  )

  // 上传单个文件（独立跟踪进度）
  const uploadSingleFile = async (file: File, fileId: string) => {
    try {
      const result = await api.proxyUpload(file, 'general', (pct) => {
        setUploadFiles(prev => prev.map(f => f.id === fileId
          ? { ...f, progress: Math.min(95, Math.round(pct * 0.95)) }
          : f
        ))
      })
      setUploadFiles(prev => prev.map(f => f.id === fileId
        ? { ...f, status: 'success', progress: 100, url: result.url }
        : f
      ))
      toast.success(`${file.name} 上传完成`)
    } catch (err) {
      const msg = extractErrorMessage(err)
      setUploadFiles(prev => prev.map(f => f.id === fileId
        ? { ...f, status: 'error', error: msg }
        : f
      ))
      toast.error(`${file.name} 上传失败: ${msg}`)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    e.target.value = ''
    toast.info(`已选择 ${fileList.length} 个文件，开始上传...`)

    // 立即添加所有文件到列表（uploading 状态）
    const newItems: UploadFileItem[] = fileList.map(file => ({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: formatFileSize(file.size),
      rawSize: file.size,
      status: 'uploading' as const,
      progress: 0,
      file,
    }))

    setUploadFiles(prev => [...prev, ...newItems])

    // 并发上传所有文件
    newItems.forEach(item => {
      uploadSingleFile(item.file!, item.id)
    })
  }

  // 重试失败的上传
  const retryUpload = (fileId: string) => {
    const item = uploadFiles.find(f => f.id === fileId)
    if (!item?.file) return
    setUploadFiles(prev => prev.map(f => f.id === fileId
      ? { ...f, status: 'uploading', progress: 0, error: undefined }
      : f
    ))
    uploadSingleFile(item.file, fileId)
  }

  const removeFile = (id: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== id))
  }

  const toggleAgency = (agencyId: string) => {
    setSelectedAgencies(prev =>
      prev.includes(agencyId)
        ? prev.filter(id => id !== agencyId)
        : [...prev, agencyId]
    )
  }

  const handleSubmit = async () => {
    if (!projectName.trim() || !deadline || selectedAgencies.length === 0) {
      toast.error('请填写完整信息')
      return
    }

    setIsSubmitting(true)
    try {
      const project = await api.createProject({
        name: projectName.trim(),
        description: description.trim() || undefined,
        platform,
        deadline,
        agency_ids: selectedAgencies,
      })

      // If brief files were uploaded, create brief with attachments
      if (briefFiles.length > 0) {
        await api.createBrief(project.id, {
          attachments: briefFiles,
        })
      }

      toast.success('项目创建成功！')
      router.push('/brand')
    } catch (err) {
      console.error('Failed to create project:', err)
      toast.error('创建失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = projectName.trim() && deadline && selectedAgencies.length > 0

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.back()} className="p-2 hover:bg-bg-elevated rounded-full">
          <ArrowLeft size={20} className="text-text-primary" />
        </button>
        <h1 className="text-2xl font-bold text-text-primary">创建项目</h1>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">
          {/* 项目名称 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              项目名称 <span className="text-accent-coral">*</span>
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="例如：XX品牌618推广"
              className="w-full px-4 py-3 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
            />
          </div>

          {/* 项目描述 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">项目描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述项目目标和要求..."
              className="w-full h-24 px-4 py-3 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo"
            />
          </div>

          {/* 发布平台 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              发布平台 <span className="text-accent-coral">*</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {platformOptions.map((p) => {
                const isSelected = platform === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                      isSelected
                        ? `${p.borderColor} ${p.bgColor} border-opacity-100`
                        : 'border-border-subtle hover:border-accent-indigo/30'
                    }`}
                  >
                    <span className="text-xl">{p.icon}</span>
                    <span className={`font-medium ${isSelected ? p.textColor : 'text-text-secondary'}`}>
                      {p.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 截止日期 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              截止日期 <span className="text-accent-coral">*</span>
            </label>
            <div className="relative">
              <Calendar size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
            </div>
          </div>

          {/* Brief 上传 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              上传 Brief 文档
            </label>

            {/* 上传区域 */}
            <label className="border-2 border-dashed border-border-subtle rounded-lg p-6 text-center hover:border-accent-indigo/50 transition-colors cursor-pointer block mb-3">
              <Upload size={28} className="mx-auto text-text-tertiary mb-2" />
              <p className="text-text-secondary text-sm mb-1">
                {uploadFiles.length > 0 ? '继续添加文件' : '点击上传 Brief 文件（可多选）'}
              </p>
              <p className="text-xs text-text-tertiary">支持 PDF、Word、Excel、图片等格式</p>
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {/* 文件列表（含进度）— 始终显示，空状态也有提示 */}
            <div className={`border rounded-lg overflow-hidden ${uploadFiles.length > 0 ? 'border-accent-indigo/40 bg-accent-indigo/5' : 'border-border-subtle'}`}>
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${uploadFiles.length > 0 ? 'bg-accent-indigo/10 border-accent-indigo/20' : 'bg-bg-elevated border-border-subtle'}`}>
                <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <FileText size={14} className="text-accent-indigo" />
                  已选文件
                </span>
                {uploadFiles.length > 0 && (
                  <span className="text-xs text-text-tertiary">
                    {briefFiles.length}/{uploadFiles.length} 完成
                    {uploadFiles.some(f => f.status === 'error') && (
                      <span className="text-accent-coral ml-1">
                        · {uploadFiles.filter(f => f.status === 'error').length} 失败
                      </span>
                    )}
                    {hasUploading && (
                      <span className="text-accent-indigo ml-1">
                        · 上传中...
                      </span>
                    )}
                  </span>
                )}
              </div>

              {uploadFiles.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-text-tertiary">还没有选择文件，点击上方区域选择</p>
                </div>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {uploadFiles.map((file) => (
                    <div key={file.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* 状态图标 */}
                        {file.status === 'uploading' && (
                          <Loader2 size={16} className="animate-spin text-accent-indigo flex-shrink-0" />
                        )}
                        {file.status === 'success' && (
                          <CheckCircle size={16} className="text-accent-green flex-shrink-0" />
                        )}
                        {file.status === 'error' && (
                          <AlertCircle size={16} className="text-accent-coral flex-shrink-0" />
                        )}

                        {/* 文件图标+文件名 */}
                        <FileText size={14} className="text-text-tertiary flex-shrink-0" />
                        <span className={`flex-1 text-sm truncate ${
                          file.status === 'error' ? 'text-accent-coral' : 'text-text-primary'
                        }`}>
                          {file.name}
                        </span>

                        {/* 大小/进度文字 */}
                        <span className="text-xs text-text-tertiary whitespace-nowrap min-w-[48px] text-right">
                          {file.status === 'uploading'
                            ? `${file.progress}%`
                            : file.size
                          }
                        </span>

                        {/* 操作按钮 */}
                        {file.status === 'error' && (
                          <button
                            type="button"
                            onClick={() => retryUpload(file.id)}
                            className="p-1 rounded hover:bg-bg-elevated text-accent-indigo transition-colors"
                            title="重试"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {file.status !== 'uploading' && (
                          <button
                            type="button"
                            onClick={() => removeFile(file.id)}
                            className="p-1 rounded hover:bg-bg-elevated text-text-tertiary hover:text-accent-coral transition-colors"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      {/* 进度条 */}
                      {file.status === 'uploading' && (
                        <div className="mt-2 ml-[30px] h-2 bg-bg-page rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-indigo rounded-full transition-all duration-300"
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      )}

                      {/* 错误提示 */}
                      {file.status === 'error' && file.error && (
                        <p className="mt-1 ml-[30px] text-xs text-accent-coral">{file.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 选择代理商 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              选择代理商 <span className="text-accent-coral">*</span>
              <span className="text-text-tertiary font-normal ml-2">
                已选择 {selectedAgencies.length} 个
              </span>
            </label>

            <div className="relative mb-4">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={agencySearch}
                onChange={(e) => setAgencySearch(e.target.value)}
                placeholder="搜索代理商名称或ID..."
                className="w-full pl-11 pr-4 py-3 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
            </div>

            {loadingAgencies ? (
              <div className="flex items-center justify-center py-8 text-text-tertiary">
                <Loader2 size={20} className="animate-spin mr-2" />
                加载代理商列表...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
                {filteredAgencies.length > 0 ? (
                  filteredAgencies.map((agency) => {
                    const isSelected = selectedAgencies.includes(agency.id)
                    return (
                      <button
                        key={agency.id}
                        type="button"
                        onClick={() => toggleAgency(agency.id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          isSelected
                            ? 'border-accent-indigo bg-accent-indigo/10'
                            : 'border-border-subtle hover:border-accent-indigo/50'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-accent-indigo' : 'bg-accent-indigo/15'
                          }`}>
                            {isSelected ? (
                              <CheckCircle size={20} className="text-white" />
                            ) : (
                              <Building2 size={20} className="text-accent-indigo" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-text-primary">{agency.name}</span>
                              <span className="text-xs text-text-tertiary font-mono">{agency.id}</span>
                            </div>
                            {agency.contact_name && (
                              <p className="text-sm text-text-secondary mt-0.5">{agency.contact_name}</p>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })
                ) : (
                  <div className="col-span-2 text-center py-8 text-text-tertiary">
                    <Search size={32} className="mx-auto mb-2 opacity-50" />
                    <p>未找到匹配的代理商</p>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-text-tertiary mt-3">
              仅显示已在&ldquo;代理商管理&rdquo;中添加的代理商
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-4 pt-4 border-t border-border-subtle">
            <Button variant="secondary" onClick={() => router.back()}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid || isSubmitting || hasUploading}>
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  创建中...
                </>
              ) : '创建项目'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
