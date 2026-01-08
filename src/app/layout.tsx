import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "WebRTC One-way Streaming MVP",
  description: "WebRTC one-way streaming application built with Next.js and Socket.io",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
