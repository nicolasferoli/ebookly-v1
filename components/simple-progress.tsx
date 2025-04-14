import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface SimpleProgressProps {
  value: number
  className?: string
  showValue?: boolean
}

export function SimpleProgress({ value, className, showValue = false }: SimpleProgressProps) {
  return (
    <div className="w-full">
      <Progress value={value} className={cn("h-2", className)} />
      {showValue && (
        <div className="flex justify-end mt-1">
          <span className="text-xs text-muted-foreground">{Math.round(value)}%</span>
        </div>
      )}
    </div>
  )
}
