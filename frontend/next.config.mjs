/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
}

export default nextConfig
