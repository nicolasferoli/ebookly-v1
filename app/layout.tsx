import type React from "react"
import "./globals.css"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Sidebar } from "@/components/sidebar"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "Gerador de Ebook",
  description: "Crie ebooks completos com apenas um título usando IA",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <div className="flex min-h-screen bg-white">
            <Sidebar />
            <main className="flex-1 md:ml-64 pt-16 md:pt-0">
              <div className="max-w-5xl mx-auto p-4 md:p-6">{children}</div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}


import './globals.css'