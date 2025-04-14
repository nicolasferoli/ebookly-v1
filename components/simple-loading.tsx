import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface SimpleLoadingProps {
  text?: string
  className?: string
}

export function SimpleLoading({ text, className }: SimpleLoadingProps) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      {text && <span className="text-sm text-muted-foreground">{text}</span>}
    </div>
  )
}
