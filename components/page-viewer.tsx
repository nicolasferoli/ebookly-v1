"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Clock, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface EbookPage {
  index: number
  content: string
  isGenerated: boolean
}

interface PageViewerProps {
  pages: EbookPage[]
  processingPages?: number[]
  queuedPages?: number[]
  onSelectPage: (index: number) => void
  selectedPageIndex: number | null
}

export function PageViewer({
  pages,
  processingPages = [],
  queuedPages = [],
  onSelectPage,
  selectedPageIndex,
}: PageViewerProps) {
  return (
    <div className="flex flex-col md:flex-row gap-4 h-[500px] border rounded-md">
      <div className="w-full md:w-1/3 h-full border-r">
        <ScrollArea className="h-full">
          <div className="p-2">
            {pages.map((page) => (
              <Button
                key={page.index}
                variant="ghost"
                className={cn(
                  "w-full justify-start text-left h-auto py-2 px-3",
                  selectedPageIndex === page.index && "bg-muted",
                )}
                onClick={() => onSelectPage(page.index)}
              >
                <div className="flex items-center w-full">
                  <span className="mr-2 text-xs text-muted-foreground">{page.index + 1}.</span>
                  <span className="truncate flex-1">Página {page.index + 1}</span>

                  {/* Ícones de status */}
                  {processingPages.includes(page.index) && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
                  {queuedPages.includes(page.index) && <Clock className="ml-auto h-3 w-3 text-muted-foreground" />}
                  {page.isGenerated && <CheckCircle2 className="ml-auto h-3 w-3 text-muted-foreground" />}
                </div>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="w-full md:w-2/3 h-full">
        <ScrollArea className="h-full">
          <div className="p-4">
            {selectedPageIndex !== null && pages.find((p) => p.index === selectedPageIndex) ? (
              <div className="prose prose-sm max-w-none">
                <h3 className="text-base font-medium mb-4">Página {selectedPageIndex + 1}</h3>
                {pages
                  .find((p) => p.index === selectedPageIndex)
                  ?.content.split("\n")
                  .map((line, i) => (
                    <div key={i} className={line.trim() === "" ? "h-4" : ""}>
                      {line}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <p>Selecione uma página para visualizar</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
