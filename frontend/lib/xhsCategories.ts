export const XHS_OTHER_CATEGORY_VALUE = 'other'

export const XHS_CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'beauty', label: '美妆护肤' },
  { value: 'personal_care', label: '个护清洁' },
  { value: 'mother_baby', label: '母婴亲子' },
  { value: 'food_beverage', label: '食品饮料' },
  { value: 'health', label: '保健营养' },
  { value: 'apparel', label: '服饰鞋包' },
  { value: 'jewelry', label: '珠宝配饰' },
  { value: 'digital', label: '数码电子' },
  { value: 'home_appliance', label: '家电' },
  { value: 'home_living', label: '家居家装' },
  { value: 'daily_use', label: '日用百货' },
  { value: 'pet', label: '宠物' },
  { value: 'sports_outdoor', label: '运动户外' },
  { value: 'automotive', label: '汽车出行' },
  { value: 'education', label: '教育培训' },
  { value: 'local_service', label: '本地生活' },
  { value: 'finance', label: '金融保险' },
  { value: 'travel', label: '酒旅出行' },
  { value: 'medical_health', label: '医疗健康' },
]

export function isKnownXHSCategory(value?: string | null) {
  if (!value) return false
  return XHS_CATEGORY_OPTIONS.some((option) => option.value === value)
}

export function resolveXHSCategorySelectValue(value?: string | null) {
  if (!value) return ''
  if (isKnownXHSCategory(value)) return value
  return XHS_OTHER_CATEGORY_VALUE
}

export function getXHSCategoryLabel(value?: string | null) {
  if (!value) return '未设置'
  if (value === XHS_OTHER_CATEGORY_VALUE) return '其它'

  const matched = XHS_CATEGORY_OPTIONS.find((option) => option.value === value)
  if (matched) return matched.label

  return `其它（${value}）`
}
