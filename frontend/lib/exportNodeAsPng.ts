function copyComputedStyles(source: Element, target: Element) {
  const computedStyle = window.getComputedStyle(source)
  const targetStyle = (target as HTMLElement).style

  Array.from(computedStyle).forEach((property) => {
    targetStyle.setProperty(
      property,
      computedStyle.getPropertyValue(property),
      computedStyle.getPropertyPriority(property),
    )
  })

  if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
    target.value = source.value
  }

  if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
    target.value = source.value
    target.textContent = source.value
  }

  if (source instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) {
    const context = target.getContext('2d')
    if (context) {
      context.drawImage(source, 0, 0)
    }
  }
}

function cloneNodeWithStyles<T extends HTMLElement>(node: T): T {
  const clone = node.cloneNode(true) as T

  const walk = (source: Element, target: Element) => {
    copyComputedStyles(source, target)

    const sourceChildren = Array.from(source.children)
    const targetChildren = Array.from(target.children)
    sourceChildren.forEach((child, index) => {
      if (targetChildren[index]) {
        walk(child, targetChildren[index])
      }
    })
  }

  walk(node, clone)
  return clone
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'sync'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片导出失败'))
    image.src = url
  })
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]+/g, '-').trim() || '达人修改图'
}

export async function exportNodeAsPng(node: HTMLElement, fileName: string) {
  if (!node) {
    throw new Error('未找到可导出的内容')
  }

  if ('fonts' in document) {
    try {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready
    } catch {
      // ignore font readiness failures
    }
  }

  const rect = node.getBoundingClientRect()
  const width = Math.max(1, Math.ceil(rect.width))
  const height = Math.max(1, Math.ceil(rect.height))
  const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2))

  const clone = cloneNodeWithStyles(node)
  clone.style.margin = '0'
  clone.style.transform = 'none'

  const wrapper = document.createElement('div')
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  wrapper.style.width = `${width}px`
  wrapper.style.height = `${height}px`
  wrapper.style.background = '#ffffff'
  wrapper.style.display = 'block'
  wrapper.appendChild(clone)

  const markup = new XMLSerializer().serializeToString(wrapper)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${markup}</foreignObject>
    </svg>
  `

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('无法创建导出画布')
    }

    context.scale(scale, scale)
    context.drawImage(image, 0, 0, width, height)

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((generatedBlob) => {
        if (generatedBlob) {
          resolve(generatedBlob)
          return
        }
        reject(new Error('PNG 导出失败'))
      }, 'image/png')
    })

    const downloadUrl = URL.createObjectURL(pngBlob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = `${sanitizeFileName(fileName)}.png`
    anchor.click()
    URL.revokeObjectURL(downloadUrl)
  } finally {
    URL.revokeObjectURL(url)
  }
}
