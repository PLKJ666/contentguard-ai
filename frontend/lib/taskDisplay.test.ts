import { describe, expect, it } from 'vitest'
import { formatLegacyTaskNameInMessageContent, formatTaskDisplayName, formatTaskDisplayTitle } from './taskDisplay'

describe('taskDisplay', () => {
  it('converts legacy auto-generated task names into project-based display names', () => {
    expect(formatTaskDisplayName({
      taskName: '宣传任务(1)',
      projectName: '麦奶咖新品抖音种草',
      sequence: 1,
    })).toBe('麦奶咖新品抖音种草 任务1')
  })

  it('keeps custom task names unchanged', () => {
    expect(formatTaskDisplayName({
      taskName: '达人口播版A',
      projectName: '麦奶咖新品抖音种草',
      sequence: 2,
    })).toBe('达人口播版A')
  })

  it('builds a combined title for custom task names', () => {
    expect(formatTaskDisplayTitle({
      taskName: '达人口播版A',
      projectName: '麦奶咖新品抖音种草',
      sequence: 2,
    })).toBe('麦奶咖新品抖音种草 · 达人口播版A')
  })

  it('avoids repeating the project name for legacy task titles', () => {
    expect(formatTaskDisplayTitle({
      taskName: '宣传任务(2)',
      projectName: '麦奶咖新品抖音种草',
      sequence: 2,
    })).toBe('麦奶咖新品抖音种草 任务2')
  })

  it('rewrites legacy new-task message content', () => {
    expect(formatLegacyTaskNameInMessageContent('您有新的任务「宣传任务(1)」，来自项目「麦奶咖新品抖音种草」'))
      .toBe('您有新的任务「麦奶咖新品抖音种草 任务1」，来自项目「麦奶咖新品抖音种草」')
  })

  it('rewrites legacy project-assignment message content', () => {
    expect(formatLegacyTaskNameInMessageContent('代理商「ContentGuard」将达人「Cathy」加入项目「麦奶咖新品抖音种草」，任务：宣传任务(1)'))
      .toBe('代理商「ContentGuard」将达人「Cathy」加入项目「麦奶咖新品抖音种草」，任务：麦奶咖新品抖音种草 任务1')
  })
})
