import { Progress } from "@/components/ui/progress"

interface GenerationStatusProps {
  progress: number
  stats: {
    processing: number
    queued: number
    completed: number
    failed: number
    total: number
  }
  estimatedTime?: string
}

export function GenerationStatus({ progress, stats, estimatedTime }: GenerationStatusProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between text-sm mb-1">
        <span>Progresso: {Math.round(progress)}%</span>
        {estimatedTime && <span className="text-muted-foreground">{estimatedTime}</span>}
      </div>

      <Progress value={progress} className="h-2" />

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Em processamento:</span> <span>{stats.processing}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Na fila:</span> <span>{stats.queued}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Concluídas:</span> <span>{stats.completed}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Com erro:</span> <span>{stats.failed}</span>
        </div>
      </div>
    </div>
  )
}
