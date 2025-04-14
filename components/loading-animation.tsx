import { cn } from "@/lib/utils"

interface LoadingAnimationProps {
  size?: "sm" | "md" | "lg"
  text?: string
  className?: string
}

export function LoadingAnimation({ size = "md", text, className }: LoadingAnimationProps) {
  const sizeClass = {
    sm: "h-4 w-4",
    md: "h-8 w-8",
    lg: "h-12 w-12",
  }

  return (
    <div className={cn("flex flex-col items-center justify-center", className)}>
      <div className="relative">
        <div className={cn("rounded-full border-t-2 border-primary animate-spin", sizeClass[size])} />
        <div className={cn("absolute inset-0 rounded-full border-2 border-primary/20", sizeClass[size])} />
      </div>
      {text && <p className="mt-3 text-sm text-muted-foreground">{text}</p>}
    </div>
  )
}
