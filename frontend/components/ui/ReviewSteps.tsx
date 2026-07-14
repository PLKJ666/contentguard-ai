/**
 * ReviewSteps 审核进度条组件
 * 设计稿参考: pencil-new.pen 达人端任务列表
 * 显示4个步骤：已提交 → AI审核中 → 代理商审核 → 审核通过
 */
import React from 'react'
import { Check, X, Loader2, Users } from 'lucide-react'

export type StepStatus = 'done' | 'current' | 'failed' | 'pending'

export interface ReviewStep {
  key: string
  label: string
  status: StepStatus
}

interface ReviewStepsProps {
  steps: ReviewStep[]
  className?: string
}

function StepIcon({ status, isLast }: { status: StepStatus; isLast: boolean }) {
  const baseClass = 'w-7 h-7 rounded-full flex items-center justify-center'

  switch (status) {
    case 'done':
      return (
        <div className={`${baseClass} bg-accent-green`}>
          <Check size={14} className="text-white" />
        </div>
      )
    case 'current':
      return (
        <div className={`${baseClass} bg-accent-indigo`}>
          <Loader2 size={14} className="text-white animate-spin" />
        </div>
      )
    case 'failed':
      return (
        <div className={`${baseClass} bg-accent-coral`}>
          <X size={14} className="text-white" />
        </div>
      )
    case 'pending':
    default:
      return (
        <div className={`${baseClass} bg-bg-elevated border-[1.5px] border-border-subtle`}>
          {isLast ? (
            <Check size={14} className="text-text-tertiary" />
          ) : (
            <Users size={14} className="text-text-tertiary" />
          )}
        </div>
      )
  }
}

function StepLine({ active }: { active: boolean }) {
  return (
    <div
      className={`flex-1 h-0.5 mx-1 ${active ? 'bg-accent-green' : 'bg-border-subtle'}`}
    />
  )
}

export const ReviewSteps: React.FC<ReviewStepsProps> = ({ steps, className = '' }) => {
  return (
    <div className={`flex items-center w-full py-2 ${className}`}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        const nextStepActive = index < steps.length - 1 &&
          (steps[index + 1].status === 'done' || steps[index + 1].status === 'current' || steps[index + 1].status === 'failed')

        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center w-[70px]">
              <StepIcon status={step.status} isLast={isLast} />
              <span
                className={`text-[11px] mt-1 font-medium ${
                  step.status === 'done' ? 'text-text-secondary' :
                  step.status === 'current' ? 'text-accent-indigo' :
                  step.status === 'failed' ? 'text-accent-coral' :
                  'text-text-tertiary'
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && <StepLine active={step.status === 'done' || nextStepActive} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// 根据任务状态生成步骤数据 (达人端视角)
export function getReviewSteps(taskStatus: string): ReviewStep[] {
  switch (taskStatus) {
    case 'pending_upload':
      return [
        { key: 'submitted', label: '已提交', status: 'pending' },
        { key: 'ai_review', label: 'AI审核', status: 'pending' },
        { key: 'agent_review', label: '代理商审核', status: 'pending' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    case 'ai_reviewing':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核中', status: 'current' },
        { key: 'agent_review', label: '代理商审核', status: 'pending' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    case 'agent_reviewing':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商审核', status: 'current' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    case 'need_revision':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: '需修改', status: 'failed' },
        { key: 'agent_review', label: '代理商审核', status: 'pending' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    case 'passed':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商审核', status: 'done' },
        { key: 'passed', label: '审核通过', status: 'done' },
      ]
    case 'rejected':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '已驳回', status: 'failed' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    default:
      return [
        { key: 'submitted', label: '已提交', status: 'pending' },
        { key: 'ai_review', label: 'AI审核', status: 'pending' },
        { key: 'agent_review', label: '代理商审核', status: 'pending' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
  }
}

// 品牌方终审视角的审核步骤
export function getBrandReviewSteps(taskStatus: string): ReviewStep[] {
  switch (taskStatus) {
    case 'ai_reviewing':
    case 'script_ai_review':
    case 'video_ai_review':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'current' },
        { key: 'agent_review', label: '代理商初审', status: 'pending' },
        { key: 'brand_review', label: '品牌方终审', status: 'pending' },
      ]
    case 'agent_reviewing':
    case 'script_agency_review':
    case 'video_agency_review':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商初审', status: 'current' },
        { key: 'brand_review', label: '品牌方终审', status: 'pending' },
      ]
    case 'brand_reviewing':
    case 'script_brand_review':
    case 'video_brand_review':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商初审', status: 'done' },
        { key: 'brand_review', label: '品牌方终审', status: 'current' },
      ]
    case 'passed':
    case 'video_upload':
    case 'completed':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商初审', status: 'done' },
        { key: 'brand_review', label: '已通过', status: 'done' },
      ]
    case 'rejected':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商初审', status: 'done' },
        { key: 'brand_review', label: '已驳回', status: 'failed' },
      ]
    default:
      // script_upload 等未知状态，默认显示为待提交
      return [
        { key: 'submitted', label: '已提交', status: 'pending' },
        { key: 'ai_review', label: 'AI审核', status: 'pending' },
        { key: 'agent_review', label: '代理商初审', status: 'pending' },
        { key: 'brand_review', label: '品牌方终审', status: 'pending' },
      ]
  }
}

// 代理商视角的审核步骤 (包含品牌终审)
export function getAgencyReviewSteps(taskStatus: string): ReviewStep[] {
  switch (taskStatus) {
    case 'ai_reviewing':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'current' },
        { key: 'agent_review', label: '代理商', status: 'pending' },
        { key: 'brand_review', label: '品牌终审', status: 'pending' },
      ]
    case 'agent_reviewing':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商', status: 'current' },
        { key: 'brand_review', label: '品牌终审', status: 'pending' },
      ]
    case 'brand_reviewing':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商', status: 'done' },
        { key: 'brand_review', label: '品牌终审', status: 'current' },
      ]
    case 'need_revision':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: '需修改', status: 'failed' },
        { key: 'agent_review', label: '代理商', status: 'pending' },
        { key: 'brand_review', label: '品牌终审', status: 'pending' },
      ]
    case 'passed':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商', status: 'done' },
        { key: 'brand_review', label: '品牌终审', status: 'done' },
      ]
    case 'rejected':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '已驳回', status: 'failed' },
        { key: 'brand_review', label: '品牌终审', status: 'pending' },
      ]
    default:
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'agent_review', label: '代理商', status: 'current' },
        { key: 'brand_review', label: '品牌终审', status: 'pending' },
      ]
  }
}

export function getOperatorReviewSteps(taskStatus: string): ReviewStep[] {
  switch (taskStatus) {
    case 'ai_reviewing':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'current' },
        { key: 'operator_review', label: '代运营审核', status: 'pending' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    case 'agent_reviewing':
    case 'script_agency_review':
    case 'video_agency_review':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'operator_review', label: '代运营审核', status: 'current' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    case 'passed':
    case 'video_upload':
    case 'completed':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'operator_review', label: '代运营审核', status: 'done' },
        { key: 'passed', label: '审核通过', status: 'done' },
      ]
    case 'rejected':
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'operator_review', label: '已驳回', status: 'failed' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
    default:
      return [
        { key: 'submitted', label: '已提交', status: 'done' },
        { key: 'ai_review', label: 'AI审核', status: 'done' },
        { key: 'operator_review', label: '代运营审核', status: 'current' },
        { key: 'passed', label: '审核通过', status: 'pending' },
      ]
  }
}

export default ReviewSteps
