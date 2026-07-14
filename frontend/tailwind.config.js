/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ========================================
      // Colors - 颜色系统 (严格按照设计文件)
      // ========================================
      colors: {
        // 背景色 (通过 CSS 变量，支持主题切换)
        'bg-page': 'rgb(var(--bg-page) / <alpha-value>)',
        'bg-card': 'rgb(var(--bg-card) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--bg-elevated) / <alpha-value>)',

        // 文字色
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-tertiary': 'rgb(var(--text-tertiary) / <alpha-value>)',

        // 强调色
        'accent-indigo': 'rgb(var(--accent-indigo) / <alpha-value>)',
        'accent-green': 'rgb(var(--accent-green) / <alpha-value>)',
        'accent-coral': 'rgb(var(--accent-coral) / <alpha-value>)',
        'accent-amber': 'rgb(var(--accent-amber) / <alpha-value>)',
        'accent-blue': 'rgb(var(--accent-blue) / <alpha-value>)',

        // 边框色
        'border-subtle': 'rgb(var(--border-subtle) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',

        // 状态色 (带透明度，保持 rgba 格式)
        'status-success': 'rgba(50, 213, 131, 0.125)',
        'status-pending': 'rgba(99, 102, 241, 0.125)',
        'status-error': 'rgba(232, 90, 79, 0.125)',
        'status-warning': 'rgba(255, 181, 71, 0.125)',
      },

      // ========================================
      // Typography - 字体系统
      // ========================================
      fontFamily: {
        sans: ['DM Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'serif'],
      },

      // ========================================
      // Border Radius - 圆角系统
      // ========================================
      borderRadius: {
        'btn': '10px',
        'card': '14px',
        'sm': '6px',
        'md': '10px',
        'lg': '14px',
        'xl': '20px',
        '2xl': '24px',
        '3xl': '31px',
        'full': '9999px',
      },

      // ========================================
      // Spacing - 间距系统
      // ========================================
      spacing: {
        '4.5': '18px',
        '13': '52px',
        '15': '60px',
        '18': '72px',
        '21': '84px',
        '22': '88px',
        '65': '260px',
        '83': '332px',
      },

      // ========================================
      // Sizes - 尺寸
      // ========================================
      width: {
        'sidebar': '260px',
        'mobile': '402px',
      },
      height: {
        'status-bar': '44px',
        'bottom-nav': '95px',
        'nav-bar': '62px',
        'mobile': '874px',
      },
      minHeight: {
        'screen-mobile': '874px',
      },
      maxWidth: {
        'mobile': '402px',
        'desktop': '1440px',
      },

      // ========================================
      // Box Shadow - 阴影 (优化为更通透的多层阴影)
      // ========================================
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'elevated': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'nav': '0 -4px 12px 0 rgba(0, 0, 0, 0.15)',
        'coral': '0 10px 15px -3px rgba(232, 90, 79, 0.2), 0 4px 6px -2px rgba(232, 90, 79, 0.1)',
        'indigo': '0 10px 15px -3px rgba(99, 102, 241, 0.2), 0 4px 6px -2px rgba(99, 102, 241, 0.1)',
      },

      // ========================================
      // Animations - 动画
      // ========================================
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },

      // ========================================
      // Z-Index - 层级
      // ========================================
      zIndex: {
        'sidebar': '40',
        'bottom-nav': '50',
        'modal': '60',
        'toast': '70',
      },
    },
  },
  plugins: [],
};
