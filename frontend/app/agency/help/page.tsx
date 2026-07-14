'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  ArrowLeft,
  MessageCircleQuestion,
  ChevronDown,
  ChevronUp,
  Search,
  FileText,
  Video,
  Users,
  BarChart3,
  MessageSquare,
  Headphones,
  Mail,
  Phone
} from 'lucide-react'

// FAQ类型
interface FAQ {
  id: string
  category: string
  question: string
  answer: string
}

// FAQ数据
const faqData: FAQ[] = [
  {
    id: 'faq-1',
    category: '审核相关',
    question: '如何查看待审核的任务？',
    answer: '进入"审核台"页面，您可以看到所有待审核的脚本和视频任务。系统会按照紧急程度和提交时间排序，优先显示即将超时的任务。',
  },
  {
    id: 'faq-2',
    category: '审核相关',
    question: 'AI审核标记的问题一定要处理吗？',
    answer: 'AI审核结果仅供参考。作为代理商，您可以根据实际情况判断AI标记的问题是否需要驳回。如果您认为AI误判，可以直接通过该内容。',
  },
  {
    id: 'faq-3',
    category: '达人管理',
    question: '如何邀请新达人加入？',
    answer: '进入"达人管理"页面，点击"邀请达人"按钮，输入达人的ID（CR开头的6位数字），系统会发送邀请通知给达人。达人确认后即可加入您的团队。',
  },
  {
    id: 'faq-4',
    category: '达人管理',
    question: '如何给达人分配项目？',
    answer: '在达人管理列表中，点击达人卡片右侧的操作菜单，选择"分配项目"，然后选择要分配的项目即可。',
  },
  {
    id: 'faq-5',
    category: '申诉处理',
    question: '达人申诉后多久需要处理？',
    answer: '建议在24小时内处理达人的申诉请求。超时未处理的申诉会自动升级提醒。您可以在"申诉处理"页面查看所有待处理的申诉。',
  },
  {
    id: 'faq-6',
    category: '申诉处理',
    question: '申诉通过后会发生什么？',
    answer: '申诉通过后，原审核问题会被撤销，任务状态会更新为"已通过"，达人可以继续进行下一步操作。同时系统会通知达人申诉结果。',
  },
  {
    id: 'faq-7',
    category: '数据报表',
    question: '如何导出审核数据？',
    answer: '进入"数据报表"页面，选择需要的时间范围，然后点击"导出报表"按钮。支持导出Excel、CSV和PDF格式。',
  },
  {
    id: 'faq-8',
    category: '账号相关',
    question: '如何修改代理商信息？',
    answer: '进入"个人中心"，点击"公司信息"可以修改公司名称、联系方式等信息。注意：公司全称和营业执照信息修改需要重新审核。',
  },
]

// 分类图标配置
const categoryIcons: Record<string, { icon: React.ElementType; color: string }> = {
  '审核相关': { icon: FileText, color: 'text-accent-indigo' },
  '达人管理': { icon: Users, color: 'text-accent-green' },
  '申诉处理': { icon: MessageSquare, color: 'text-accent-amber' },
  '数据报表': { icon: BarChart3, color: 'text-accent-blue' },
  '账号相关': { icon: Users, color: 'text-purple-400' },
}

// FAQ Item组件
function FAQItem({ faq }: { faq: FAQ }) {
  const [isOpen, setIsOpen] = useState(false)
  const categoryConfig = categoryIcons[faq.category] || { icon: MessageCircleQuestion, color: 'text-text-secondary' }
  const Icon = categoryConfig.icon

  return (
    <div className="border-b border-border-subtle last:border-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 text-left hover:bg-bg-elevated/30 transition-colors px-2 -mx-2 rounded-lg"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg bg-opacity-15 flex items-center justify-center`}
            style={{ backgroundColor: `${categoryConfig.color.replace('text-', '')}15` }}
          >
            <Icon size={16} className={categoryConfig.color} />
          </div>
          <div>
            <span className="text-xs text-text-tertiary">{faq.category}</span>
            <p className="font-medium text-text-primary">{faq.question}</p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp size={20} className="text-text-tertiary flex-shrink-0" />
        ) : (
          <ChevronDown size={20} className="text-text-tertiary flex-shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="pb-4 pl-13 pr-4">
          <p className="text-text-secondary leading-relaxed pl-11">{faq.answer}</p>
        </div>
      )}
    </div>
  )
}

export default function AgencyHelpPage() {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('全部')

  // 获取所有分类
  const categories = ['全部', ...Array.from(new Set(faqData.map(f => f.category)))]

  // 筛选FAQ
  const filteredFAQ = faqData.filter(faq => {
    const matchesSearch = searchQuery === '' ||
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === '全部' || faq.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">帮助与反馈</h1>
          <p className="text-sm text-text-secondary mt-0.5">常见问题解答和联系客服</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：FAQ */}
        <div className="lg:col-span-2 space-y-6">
          {/* 搜索 */}
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder="搜索常见问题..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 border border-border-subtle rounded-xl bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
            />
          </div>

          {/* 分类筛选 */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-accent-indigo text-white'
                    : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* FAQ列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircleQuestion size={18} className="text-accent-indigo" />
                常见问题
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredFAQ.length > 0 ? (
                filteredFAQ.map((faq) => (
                  <FAQItem key={faq.id} faq={faq} />
                ))
              ) : (
                <div className="text-center py-8 text-text-tertiary">
                  <MessageCircleQuestion size={48} className="mx-auto mb-4 opacity-50" />
                  <p>没有找到相关问题</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：联系客服 */}
        <div className="space-y-6">
          {/* 在线客服 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Headphones size={18} className="text-accent-green" />
                联系客服
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-text-secondary">
                如果您的问题未在FAQ中找到答案，可以通过以下方式联系我们
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-elevated">
                  <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
                    <Headphones size={20} className="text-accent-indigo" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">在线客服</p>
                    <p className="text-sm text-text-tertiary">工作日 9:00-18:00</p>
                  </div>
                  <Button variant="primary" size="sm">
                    立即咨询
                  </Button>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-elevated">
                  <div className="w-10 h-10 rounded-lg bg-accent-green/15 flex items-center justify-center">
                    <Phone size={20} className="text-accent-green" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">客服热线</p>
                    <p className="text-sm text-accent-indigo font-mono">400-888-8888</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-elevated">
                  <div className="w-10 h-10 rounded-lg bg-accent-blue/15 flex items-center justify-center">
                    <Mail size={20} className="text-accent-blue" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">邮件支持</p>
                    <p className="text-sm text-accent-indigo">support@example.com</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 意见反馈 */}
          <Card>
            <CardHeader>
              <CardTitle>意见反馈</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                placeholder="请描述您遇到的问题或建议..."
                className="w-full h-32 p-3 rounded-xl bg-bg-elevated border border-border-subtle text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
              <Button variant="primary" className="w-full">
                提交反馈
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
