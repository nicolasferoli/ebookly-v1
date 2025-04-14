import { cn } from "@/lib/utils"

interface StepIndicatorProps {
  steps: string[]
  currentStep: number
  className?: string
}

export function StepIndicator({ steps, currentStep, className }: StepIndicatorProps) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex justify-between mb-2">
        {steps.map((step, index) => (
          <div
            key={index}
            className={cn(
              "flex flex-col items-center",
              currentStep >= index + 1 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full border text-sm",
                currentStep > index + 1
                  ? "border-foreground"
                  : currentStep === index + 1
                    ? "border-foreground"
                    : "border-muted",
              )}
            >
              {index + 1}
            </div>
            <span className="mt-2 text-center text-xs hidden sm:block">{step}</span>
          </div>
        ))}
      </div>
      <div className="relative mt-2">
        <div className="absolute inset-0 flex">
          {steps.map((_, index) => (
            <div
              key={index}
              className={cn(
                "h-1 flex-1",
                index < steps.length - 1 && (currentStep > index + 1 ? "bg-foreground" : "bg-muted"),
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
