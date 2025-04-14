"use client"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2, Clock, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface EbookPage {
  index: number
  content: string
  isGenerated: boolean
}

interface EbookPageViewerProps {
  pages: EbookPage[]
  isLoading?: boolean
  processingPages?: number[]
  queuedPages?: number[]
  onSelectPage: (index: number) => void
  selectedPageIndex: number | null
}

export function EbookPageViewer({
  pages,
  isLoading = false,
  processingPages = [],
  queuedPages = [],
  onSelectPage,
  selectedPageIndex,
}: EbookPageViewerProps) {
  return (
    <div className="flex flex-col md:flex-row gap-4 h-[500px]">
      <Card className="w-full md:w-1/3 h-full">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-1">
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 animate-pulse rounded-md mb-1" />
                ))
              : pages.map((page) => (
                  <Button
                    key={page.index}
                    variant={selectedPageIndex === page.index ? "default" : "ghost"}
                    className={cn(
                      "w-full justify-start text-left h-auto py-2",
                      page.isGenerated ? "text-foreground" : "text-muted-foreground",
                    )}
                    onClick={() => onSelectPage(page.index)}
                  >
                    <div className="flex items-center w-full">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted mr-2 text-xs font-medium">
                        {page.index + 1}
                      </div>
                      <span className="truncate flex-1">Página {page.index + 1}</span>

                      {/* Ícones de status */}
                      {processingPages.includes(page.index) && (
                        <Loader2 className="ml-auto h-3 w-3 animate-spin text-amber-500" />
                      )}
                      {queuedPages.includes(page.index) && <Clock className="ml-auto h-3 w-3 text-blue-500" />}
                      {page.isGenerated && <CheckCircle2 className="ml-auto h-3 w-3 text-green-500" />}
                    </div>
                  </Button>
                ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="w-full md:w-2/3 h-full">
        <ScrollArea className="h-full">
          <CardContent className="p-4">
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-6 bg-gray-100 animate-pulse rounded-md w-1/3 mb-4" />
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-4 bg-gray-100 animate-pulse rounded-md w-full" />
                ))}
              </div>
            ) : selectedPageIndex !== null && pages.find((p) => p.index === selectedPageIndex) ? (
              <div className="prose prose-sm max-w-none">
                <h3 className="text-lg font-semibold mb-4">Página {selectedPageIndex + 1}</h3>
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
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  )
}
