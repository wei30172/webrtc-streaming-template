/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['socket.io']
  },
  // 支援遠端部署
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          }
        ]
      }
    ]
  },
  // 優化生產環境
  compress: true,
  poweredByHeader: false,
  // 環境變數
  env: {
    CUSTOM_SERVER: 'true'
  }
}

module.exports = nextConfig
