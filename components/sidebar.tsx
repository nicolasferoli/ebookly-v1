"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookText, Plus, Library, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"

const sidebarLinks = [
  {
    name: "Gerador",
    href: "/",
    icon: Plus,
  },
  {
    name: "Biblioteca",
    href: "/biblioteca",
    icon: Library,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false

  // Fechar o menu quando mudar de página em dispositivos móveis
  useEffect(() => {
    if (isMobile) {
      setIsOpen(false)
    }
  }, [pathname, isMobile])

  return (
    <>
      {/* Botão de menu móvel */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden fixed top-4 left-4 z-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-background border-r transform transition-transform duration-200 md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 p-4 border-b">
            <BookText className="h-5 w-5" />
            <h2 className="text-lg font-medium">Gerador de Ebooks</h2>
          </div>

          <div className="p-2 space-y-1 flex-1">
            {sidebarLinks.map((link) => {
              const Icon = link.icon
              const isActive = pathname === link.href

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-[--sidebar-primary] text-[--sidebar-primary-foreground] font-medium"
                      : "text-[--sidebar-foreground] hover:bg-[--sidebar-accent] hover:text-[--sidebar-accent-foreground]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{link.name}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      {/* Overlay para fechar o menu em dispositivos móveis */}
      {isOpen && <div className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => setIsOpen(false)} />}
    </>
  )
}
