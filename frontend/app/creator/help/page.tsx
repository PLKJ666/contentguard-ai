'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  MessageCircle,
  Phone,
  Mail,
  FileQuestion,
  Video,
  FileText,
  AlertCircle,
  Send
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'

// FAQ 数据
const faqData = [
  {
    category: '任务相关',
    icon: FileText,
    questions: [
      {
        q: '如何接收新任务？',
        a: '您需要先接受代理商的签约邀请，成为签约达人后即可在"我的任务"中查看分配给您的推广任务。',
      },
      {
        q: '脚本被驳回后可以申诉吗？',
        a: '可以的。在任务详情页面点击"申诉"按钮，填写申诉原因并上传证明材料即可。每月有5次申诉机会。',
      },
      {
        q: '视频上传有什么格式要求？',
        a: '支持 MP4、MOV 格式，文件大小不超过 100MB，建议分辨率 1080P 以上，时长根据任务要求而定。',
      },
    ],
  },
  {
    category: '审核流程',
    icon: Video,
    questions: [
      {
        q: 'AI 审核需要多长时间？',
        a: 'AI 审核通常在 2-5 分钟内完成。如果队列繁忙，可能需要更长时间，您可以离开页面，审核完成后会通过消息中心通知您。',
      },
      {
        q: '代理商审核和品牌方审核有什么区别？',
        a: '代理商审核主要检查内容质量和基本合规性，品牌方审核则侧重于品牌调性和营销效果的把控。',
      },
      {
        q: '审核不通过的常见原因有哪些？',
        a: '常见原因包括：违禁词使用、竞品露出、品牌调性不符、卖点表达不清晰、视频画质或音质问题等。',
      },
    ],
  },
  {
    category: '账户问题',
    icon: AlertCircle,
    questions: [
      {
        q: '如何修改绑定的手机号？',
        a: '进入"个人中心"→"账户设置"，在手机号绑定区域点击"更换"，按提示完成验证即可。',
      },
      {
        q: '申诉次数用完了怎么办？',
        a: '您可以在"申诉中心"点击"申请增加"按钮，提交申请后等待审核。通过率高的达人更容易获得额外申诉机会。',
      },
    ],
  },
]

// FAQ 项组件
function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 text-left"
      >
        <span className="text-sm font-medium text-text-primary pr-4">{question}</span>
        <ChevronDown
          className={cn(
            'w-5 h-5 text-text-tertiary flex-shrink-0 transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>
      {isOpen && (
        <div className="pb-4">
          <p className="text-sm text-text-secondary leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  )
}

// FAQ 分类组件
function FAQCategory({ category, icon: Icon, questions }: {
  category: string
  icon: React.ElementType
  questions: { q: string; a: string }[]
}) {
  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-accent-indigo/15 flex items-center justify-center">
          <Icon className="w-5 h-5 text-accent-indigo" />
        </div>
        <span className="text-lg font-semibold text-text-primary">{category}</span>
      </div>
      <div className="flex flex-col">
        {questions.map((item, index) => (
          <FAQItem key={index} question={item.q} answer={item.a} />
        ))}
      </div>
    </div>
  )
}

// 联系方式卡片
function ContactCard() {
  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow">
      <h3 className="text-lg font-semibold text-text-primary mb-4">联系我们</h3>
      <div className="flex flex-col gap-4">
        <a
          href="#"
          className="flex items-center gap-4 p-4 bg-bg-elevated rounded-xl hover:bg-bg-page transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-green/15 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-accent-green" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-medium text-text-primary">在线客服</span>
            <p className="text-xs text-text-tertiary">工作日 9:00-18:00</p>
          </div>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </a>
        <a
          href="tel:400-123-4567"
          className="flex items-center gap-4 p-4 bg-bg-elevated rounded-xl hover:bg-bg-page transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-blue/15 flex items-center justify-center">
            <Phone className="w-5 h-5 text-accent-blue" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-medium text-text-primary">客服热线</span>
            <p className="text-xs text-text-tertiary">400-123-4567</p>
          </div>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </a>
        <a
          href="mailto:support@example.com"
          className="flex items-center gap-4 p-4 bg-bg-elevated rounded-xl hover:bg-bg-page transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
            <Mail className="w-5 h-5 text-purple-400" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-medium text-text-primary">邮件反馈</span>
            <p className="text-xs text-text-tertiary">support@example.com</p>
          </div>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </a>
      </div>
    </div>
  )
}

// 反馈表单
function FeedbackForm() {
  const [feedback, setFeedback] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = () => {
    if (feedback.trim()) {
      setSubmitted(true)
      setFeedback('')
      setTimeout(() => setSubmitted(false), 3000)
    }
  }

  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow">
      <h3 className="text-lg font-semibold text-text-primary mb-4">意见反馈</h3>
      {submitted ? (
        <div className="flex items-center gap-3 p-4 bg-accent-green/15 rounded-xl">
          <FileQuestion className="w-5 h-5 text-accent-green" />
          <span className="text-sm text-accent-green">感谢您的反馈！我们会认真处理。</span>
        </div>
      ) : (
        <>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="请描述您遇到的问题或提出建议..."
            className="w-full h-32 p-4 bg-bg-elevated rounded-xl text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo resize-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!feedback.trim()}
            className={cn(
              'w-full mt-4 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
              feedback.trim()
                ? 'bg-accent-indigo text-white hover:bg-accent-indigo/90'
                : 'bg-bg-elevated text-text-tertiary cursor-not-allowed'
            )}
          >
            <Send className="w-4 h-4" />
            提交反馈
          </button>
        </>
      )}
    </div>
  )
}

export default function CreatorHelpPage() {
  const router = useRouter()

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-sm hover:bg-bg-card transition-colors w-fit mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">帮助与反馈</h1>
          <p className="text-sm lg:text-[15px] text-text-secondary">常见问题解答和联系方式</p>
        </div>

        {/* 内容区 - 响应式布局 */}
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* FAQ */}
          <div className="flex-1 flex flex-col gap-5 lg:overflow-y-auto lg:pr-2">
            {faqData.map((category, index) => (
              <FAQCategory
                key={index}
                category={category.category}
                icon={category.icon}
                questions={category.questions}
              />
            ))}
          </div>

          {/* 联系方式和反馈 */}
          <div className="lg:w-[360px] lg:flex-shrink-0 flex flex-col gap-5">
            <ContactCard />
            <FeedbackForm />
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
