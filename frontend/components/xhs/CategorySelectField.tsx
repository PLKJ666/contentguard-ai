'use client'

import {
  XHS_CATEGORY_OPTIONS,
  XHS_OTHER_CATEGORY_VALUE,
  isKnownXHSCategory,
  resolveXHSCategorySelectValue,
} from '@/lib/xhsCategories'

interface XHSCategorySelectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  allowEmpty?: boolean
  emptyLabel?: string
  customPlaceholder?: string
}

export function XHSCategorySelectField({
  label,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = '请选择品类',
  customPlaceholder = '请输入其它品类',
}: XHSCategorySelectFieldProps) {
  const selectValue = resolveXHSCategorySelectValue(value)
  const showCustomInput = selectValue === XHS_OTHER_CATEGORY_VALUE
  const customValue = !value || isKnownXHSCategory(value) || value === XHS_OTHER_CATEGORY_VALUE ? '' : value

  return (
    <label className="space-y-2 text-sm block">
      <span className="font-medium text-text-primary">{label}</span>
      <select
        value={selectValue}
        onChange={(e) => {
          const nextValue = e.target.value
          if (nextValue === XHS_OTHER_CATEGORY_VALUE) {
            onChange(!value || isKnownXHSCategory(value) ? XHS_OTHER_CATEGORY_VALUE : value)
            return
          }
          onChange(nextValue)
        }}
        className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {XHS_CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
        <option value={XHS_OTHER_CATEGORY_VALUE}>其它</option>
      </select>

      {showCustomInput && (
        <input
          value={customValue}
          onChange={(e) => onChange(e.target.value.trim() || XHS_OTHER_CATEGORY_VALUE)}
          placeholder={customPlaceholder}
          className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
        />
      )}
    </label>
  )
}
