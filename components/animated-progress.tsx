"use client"

import { useState, useEffect } from "react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface AnimatedProgressProps {
  value: number
  className?: string
  showValue?: boolean
  size?: "sm" | "md" | "lg"
  color?: "default" | "success" | "warning" | "danger"
}

export function AnimatedProgress({
  value,
  className,
  showValue = false,
  size = "md",
  color = "default",
}: AnimatedProgressProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setProgress(value)
    }, 100)
    return () => clearTimeout(timeout)
  }, [value])

  const heightClass = {
    sm: "h-2",
    md: "h-3",
    lg: "h-4",
  }

  const colorClass = {
    default: "bg-primary",
    success: "bg-green-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
  }

  return (
    <div className="w-full">
      <Progress value={progress} className={cn(heightClass[size], className)} indicatorClassName={colorClass[color]} />
      {showValue && (
        <div className="flex justify-end mt-1">
          <span className="text-xs font-medium">{Math.round(progress)}%</span>
        </div>
      )}
    </div>
  )
}
