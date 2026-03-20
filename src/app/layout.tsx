import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Product Master',
  description: 'Product catalog and UPC registry',
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
