/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Docker 部署时使用 standalone 输出模式
  output: 'standalone',

  // 环境变量
  env: {
    API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:8000',
  },

  // 图片域名白名单
  images: {
    domains: ['localhost'],
  },

  // 实验性功能
  experimental: {
    // 服务端组件
    serverComponentsExternalPackages: [],
  },

  // 强制 HTML 页面不缓存（防止 Next.js 默认的 s-maxage=31536000）
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ]
  },

  // 代理 API 请求到后端
  // API_REWRITE_TARGET: 服务端代理目标（Docker 中用 http://backend:8000）
  // NEXT_PUBLIC_API_BASE_URL: 浏览器直连后端（不走代理时使用）
  async rewrites() {
    const backendUrl = process.env.API_REWRITE_TARGET || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
    return {
      // beforeFiles: 在 filesystem routes 之前执行（空）
      beforeFiles: [],
      // afterFiles: 在 filesystem routes 之后执行
      // /api/brief-parse/* 由 Route Handler 处理（支持长超时），其余走代理
      afterFiles: [
        {
          source: '/api/v1/:path*',
          destination: `${backendUrl}/api/v1/:path*`,
        },
      ],
      // fallback: 所有都未匹配时执行（空）
      fallback: [],
    }
  },
}

module.exports = nextConfig
