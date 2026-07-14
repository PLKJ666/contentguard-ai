#!/usr/bin/env node

/**
 * 从 git log 生成 changelog.json
 * - 保留 feat / fix / perf / docs 的 Conventional Commit
 * - 支持可选 scope，例如 fix(auth): / feat(frontend):
 * - 排除含 test/lint/refactor 的纯技术 commit
 * - 有 tag 按 tag 分组，无 tag 按周分组
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'changelog.json')

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

function readExisting() {
  try {
    if (!fs.existsSync(OUTPUT_PATH)) return null
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseCommits() {
  const raw = run("git log --format='%H|%aI|%s'")
  if (!raw) return []

  return raw
    .split('\n')
    .map((line) => {
      // 去除可能的单引号包裹
      const clean = line.replace(/^'|'$/g, '')
      const [hash, dateISO, ...rest] = clean.split('|')
      const subject = rest.join('|')
      if (!hash || !dateISO || !subject) return null
      return { hash: hash.slice(0, 7), date: dateISO.slice(0, 10), subject }
    })
    .filter(Boolean)
}

function parseConventionalSubject(subject) {
  const match = subject.match(/^(feat|fix|perf|docs)(?:\(([^)]+)\))?:\s*(.+)$/)
  if (!match) return null

  const [, type, rawScope = '', rawMessage] = match
  return {
    type,
    scope: rawScope.trim().toLowerCase(),
    message: rawMessage.trim(),
  }
}

function filterUserFacing(commits) {
  // 英文技术关键词
  const techEnglish = /test|lint|refactor|chore|ci|style|build|webpack|eslint|typescript|alembic|celery|redis/i
  // 中文技术关键词 — 纯后端/部署/对接/迁移/框架类
  const techChinese = /对接.*API|API.*对接|后端.*模块|添加.*模块|前端对接|前端.*对接后端|补全.*API|对齐.*类型|种子数据|初始化脚本|迁移至|迁移到|OSS|COS|TOS.*凭证|签名.*URL|代码质量|配置说明|测试覆盖|核心流程测试|审计日志|Phase \d|前后端框架|前后端.*类型|SSE.*集成|SSE.*推送集成|数据导出|嵌套加载|更新 changelog/
  const internalScopes = new Set(['ci', 'deploy', 'release', 'infra'])
  return commits
    .map((c) => {
      const parsed = parseConventionalSubject(c.subject)
      if (!parsed) return null

      const { type, scope, message } = parsed
      if (scope && internalScopes.has(scope)) return null
      if (techEnglish.test(message)) return null
      if (techChinese.test(message)) return null
      return { type, message, hash: c.hash, date: c.date }
    })
    .filter(Boolean)
}

function getTags() {
  const raw = run('git tag -l --sort=-version:refname')
  if (!raw) return []
  return raw.split('\n').filter(Boolean)
}

function getTagDate(tag) {
  return run(`git log -1 --format='%aI' ${tag}`).replace(/'/g, '').slice(0, 10)
}

function getTagCommitHash(tag) {
  return run(`git rev-list -1 ${tag}`).slice(0, 7)
}

// ISO 周号
function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d - onejan) / 86400000 + onejan.getUTCDay() + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function formatDateChinese(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

function dedupeEntries(entries) {
  const seen = new Set()
  return entries.filter((entry) => {
    const key = `${entry.type}|${entry.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function groupByWeek(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = getWeekKey(entry.date)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  const versions = []
  for (const [weekKey, items] of groups) {
    items.sort((a, b) => b.date.localeCompare(a.date))
    const uniqueItems = dedupeEntries(items)
    const newest = uniqueItems[0].date
    const oldest = uniqueItems[uniqueItems.length - 1].date
    const title =
      newest === oldest
        ? formatDateChinese(newest)
        : `${formatDateChinese(oldest)} ~ ${formatDateChinese(newest)}`
    versions.push({
      id: weekKey,
      title,
      tag: null,
      date: newest,
      entries: uniqueItems,
    })
  }

  versions.sort((a, b) => b.date.localeCompare(a.date))
  return versions
}

function groupByTag(entries, tags) {
  // 用 git log 顺序获取所有 commit hash 列表（从新到旧）
  const allHashes = run("git log --format='%H'")
    .split('\n')
    .map((h) => h.replace(/^'|'$/g, '').slice(0, 7))
    .filter(Boolean)

  // 获取每个 tag 对应的 commit hash 和日期
  const tagInfos = tags
    .map((t) => ({
      tag: t,
      date: getTagDate(t),
      hash: getTagCommitHash(t),
    }))
    .map((t) => ({ ...t, idx: allHashes.indexOf(t.hash) }))
    .filter((t) => t.idx !== -1)

  // 按 commit 顺序排序 tag（而非日期，避免同一天多 tag 的问题）
  tagInfos.sort((a, b) => {
    return a.idx - b.idx // 越新的 commit index 越小
  })

  // 用 commit 顺序（而非日期）来划分 entries 归属
  const versions = []

  for (let i = 0; i < tagInfos.length; i++) {
    const current = tagInfos[i]
    const next = tagInfos[i + 1]

    // 找到 current tag 和 next tag 之间的所有 commit hash
    const currentIdx = current.idx
    const nextIdx = next ? next.idx : allHashes.length

    const rangeHashes = new Set(allHashes.slice(currentIdx, nextIdx))
    const tagEntries = dedupeEntries(entries.filter((e) => rangeHashes.has(e.hash)))

    if (tagEntries.length === 0) continue
    versions.push({
      id: current.tag,
      title: current.tag,
      tag: current.tag,
      date: current.date,
      entries: tagEntries,
    })
  }

  // 未打标签的 commit 不显示，等下次打标时自动归入新版本

  return versions
}

function main() {
  const commits = parseCommits()
  if (commits.length === 0) {
    // git 不可用，保留已有 JSON
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log('[changelog] git 不可用，保留已有 changelog.json')
      return
    }
    // 生成空数据
    const empty = { generatedAt: new Date().toISOString(), grouping: 'weekly', versions: [] }
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(empty, null, 2))
    console.log('[changelog] git 不可用，生成空 changelog.json')
    return
  }

  const entries = filterUserFacing(commits)
  const tags = getTags()

  let versions
  let grouping

  if (tags.length >= 1) {
    grouping = 'tagged'
    versions = groupByTag(entries, tags)
  } else {
    grouping = 'weekly'
    versions = groupByWeek(entries)
  }

  const data = {
    generatedAt: new Date().toISOString(),
    grouping,
    versions,
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  const existing = readExisting()
  if (existing && existing.grouping === data.grouping) {
    const sameVersions = JSON.stringify(existing.versions || null) === JSON.stringify(data.versions)
    if (sameVersions) {
      console.log(
        `[changelog] 无变化，跳过写入: ${versions.length} 个版本, ${entries.length} 条更新 (${grouping})`
      )
      return
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2))
  console.log(`[changelog] 生成完成: ${versions.length} 个版本, ${entries.length} 条更新 (${grouping})`)
}

main()
