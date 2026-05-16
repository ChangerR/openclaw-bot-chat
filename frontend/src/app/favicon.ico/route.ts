const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#111827"/>
  <path fill="#38bdf8" d="M17 22a9 9 0 0 1 9-9h12a9 9 0 0 1 9 9v10a9 9 0 0 1-9 9H28l-9 8v-8h-2a9 9 0 0 1-9-9V22Z"/>
  <circle cx="25" cy="27" r="3" fill="#fff"/>
  <circle cx="39" cy="27" r="3" fill="#fff"/>
</svg>`

export function GET() {
  return new Response(ICON, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
