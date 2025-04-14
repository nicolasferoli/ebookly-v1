import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

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
  // Calcular páginas restantes (processando + fila)
  const remaining = stats.processing + stats.queued

  return (
    <div className="space-y-6">
      {/* Progresso Geral */}
      <div>
        <div className="flex justify-between items-center text-sm mb-2">
          <span className="font-medium">Progresso Geral ({Math.round(progress)}%)</span>
          {estimatedTime && <span className="text-muted-foreground">{estimatedTime}</span>}
        </div>
        <Progress value={progress} className="h-4" /> {/* Barra de progresso mais alta */}
      </div>

      {/* Cards de Status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card Concluídas */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Concluídas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completed} / {stats.total}</div>
          </CardContent>
        </Card>

        {/* Card Restantes (Processando + Fila) */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Restantes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{remaining}</div>
            <p className="text-xs text-muted-foreground">
              ({stats.processing} proc. / {stats.queued} fila)
            </p>
          </CardContent>
        </Card>

        {/* Card com Erro (mostrar apenas se houver erros) */}
        {stats.failed > 0 && (
          <Card className="shadow-sm border-destructive/50"> {/* Borda vermelha sutil */}
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-destructive">Com Erro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
