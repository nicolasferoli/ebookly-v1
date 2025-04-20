import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

interface StepIndicatorProps {
  steps: string[]
  currentStep: number
  className?: string
}

export function StepIndicator({ steps, currentStep, className }: StepIndicatorProps) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex justify-between mb-4 relative">
        {/* Progress Bar Background */}
        <div className="absolute top-4 left-0 w-full h-1 bg-muted rounded-full -translate-y-1/2" />
        
        {/* Progress Bar (non-animated) */}
        <div 
          className="absolute top-4 left-0 h-1 rounded-full -translate-y-1/2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-500 ease-in-out"
          style={{ 
            width: `${Math.max(0, (currentStep - 1) / (steps.length - 1) * 100)}%` 
          }}
        />

        {/* Step Indicators */}
        {steps.map((step, index) => (
          <div
            key={index}
            className={cn(
              "flex flex-col items-center relative z-10",
              currentStep >= index + 1 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full text-sm relative transition-all duration-300",
                currentStep > index + 1 
                  ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-sm" 
                  : currentStep === index + 1
                    ? "border-2 border-primary bg-background shadow-sm" 
                    : "border border-muted bg-background"
              )}
            >
              {currentStep > index + 1 ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                <span>{index + 1}</span>
              )}
              
              {/* Pulse effect for current step (CSS-only) */}
              {currentStep === index + 1 && (
                <span 
                  className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-75"
                  style={{ animationDuration: '2s' }}
                />
              )}
            </div>
            
            <span 
              className={cn(
                "mt-2 text-center text-xs font-medium sm:block hidden transition-opacity duration-300",
                currentStep >= index + 1 ? "opacity-100" : "opacity-70"
              )}
            >
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
