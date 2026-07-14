// 平台配置 - 共享给所有端使用
export const platformOptions = [
  { id: 'douyin', name: '抖音', icon: '🎵', bgColor: 'bg-[#25F4EE]/15', textColor: 'text-[#25F4EE]', borderColor: 'border-[#25F4EE]/30' },
  { id: 'xiaohongshu', name: '小红书', icon: '📕', bgColor: 'bg-[#fe2c55]/15', textColor: 'text-[#fe2c55]', borderColor: 'border-[#fe2c55]/30' },
  { id: 'bilibili', name: 'B站', icon: '📺', bgColor: 'bg-[#00a1d6]/15', textColor: 'text-[#00a1d6]', borderColor: 'border-[#00a1d6]/30' },
  { id: 'kuaishou', name: '快手', icon: '⚡', bgColor: 'bg-[#ff4906]/15', textColor: 'text-[#ff4906]', borderColor: 'border-[#ff4906]/30' },
]

export type PlatformId = typeof platformOptions[number]['id']

export function getPlatformInfo(platformId: string) {
  return platformOptions.find(p => p.id === platformId)
}

// 平台标签组件的样式类
export function getPlatformTagClasses(platformId: string) {
  const platform = getPlatformInfo(platformId)
  if (!platform) return ''
  return `${platform.bgColor} ${platform.textColor} ${platform.borderColor}`
}
