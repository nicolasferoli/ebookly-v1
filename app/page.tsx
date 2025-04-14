"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { BookText, Download, AlertCircle, ArrowRight, Database, RefreshCw, Library } from "lucide-react"
import { getContentModes, getCurrentContentMode } from "@/lib/ebook-generator"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { EbookQueueState } from "@/lib/redis"
import { StepIndicator } from "@/components/step-indicator"
import { GenerationStatus } from "@/components/generation-status"
import { PageViewer } from "@/components/page-viewer"
import { SimpleLoading } from "@/components/simple-loading"

// Tempo médio estimado por página em segundos (varia conforme o modo de conteúdo)
const ESTIMATED_TIME_PER_PAGE = {
  FULL: 30,
  MEDIUM: 20,
  MINIMAL: 15,
  ULTRA_MINIMAL: 10,
}

// Intervalo de atualização do status (em ms)
const STATUS_UPDATE_INTERVAL = 3000

// Opções de quantidade de páginas
const PAGE_COUNT_OPTIONS = [5, 10, 15, 20, 30, 40, 50]

// Passos do processo
const STEPS = ["Nome", "Configuração", "Geração", "Conclusão"]

export default function EbookGenerator() {
  // Estados principais
  const [ebookTitle, setEbookTitle] = useState("")
  const [ebookDescription, setEbookDescription] = useState("")
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false)
  const [isGeneratingEbook, setIsGeneratingEbook] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contentMode, setContentMode] = useState<string>("MEDIUM")
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [pageCount, setPageCount] = useState<number>(15) // Valor padrão: 15 páginas

  // Estados para o sistema de filas
  const [currentEbookId, setCurrentEbookId] = useState<string | null>(null)
  const [ebookState, setEbookState] = useState<EbookQueueState | null>(null)
  const [ebookPages, setEbookPages] = useState<{ index: number; content: string }[]>([])
  const [selectedPageIndex, setSelectedPageIndex] = useState<number | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>("")

  // Adicionar estado para verificação do Redis
  const [isCheckingRedis, setIsCheckingRedis] = useState(false)
  const [redisStatus, setRedisStatus] = useState<{
    connected: boolean
    redisUrl: string
    redisToken: string
    envInfo?: { [key: string]: string }
    helpMessage?: string
  } | null>(null)

  // Referências
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const generationStartTimeRef = useRef<number>(0)

  // Modos de conteúdo disponíveis
  const contentModes = getContentModes()

  // Atualizar o modo de conteúdo quando mudar
  useEffect(() => {
    const currentMode = getCurrentContentMode()
    if (currentMode !== contentMode) {
      setContentMode(currentMode)
    }
  }, [])

  // Adicionar useEffect para iniciar/parar polling quando necessário
  useEffect(() => {
    if (currentEbookId && (isPolling || ebookState?.status === "processing" || ebookState?.status === "queued")) {
      startPolling()
    } else {
      stopPolling()
    }

    return () => stopPolling()
  }, [currentEbookId, isPolling, ebookState?.status])

  // Atualizar a estimativa de tempo restante
  useEffect(() => {
    if (!ebookState || !generationStartTimeRef.current) return

    const updateEstimatedTime = () => {
      const elapsedSeconds = (Date.now() - generationStartTimeRef.current) / 1000
      const completedPages = ebookState.completedPages

      if (completedPages === 0) return "Calculando..."

      // Calcular o tempo médio por página com base no progresso atual
      const avgTimePerPage = elapsedSeconds / completedPages

      // Estimar o tempo restante
      const remainingPages = ebookState.queuedPages + ebookState.processingPages
      const estimatedRemainingSeconds = remainingPages * avgTimePerPage

      // Formatar o tempo restante
      if (estimatedRemainingSeconds < 60) {
        return `${Math.ceil(estimatedRemainingSeconds)} segundos restantes`
      } else if (estimatedRemainingSeconds < 3600) {
        return `${Math.ceil(estimatedRemainingSeconds / 60)} minutos restantes`
      } else {
        const hours = Math.floor(estimatedRemainingSeconds / 3600)
        const minutes = Math.ceil((estimatedRemainingSeconds % 3600) / 60)
        return `${hours}h ${minutes}m restantes`
      }
    }

    const timer = setInterval(() => {
      setEstimatedTimeRemaining(updateEstimatedTime())
    }, 5000)

    setEstimatedTimeRemaining(updateEstimatedTime())

    return () => clearInterval(timer)
  }, [ebookState])

  // Função para iniciar o polling
  const startPolling = () => {
    if (pollingIntervalRef.current) return

    // Fazer a primeira atualização imediatamente
    updateEbookStatus()

    // Configurar o intervalo de atualização
    pollingIntervalRef.current = setInterval(updateEbookStatus, STATUS_UPDATE_INTERVAL)
    setIsPolling(true)
  }

  // Função para parar o polling
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setIsPolling(false)
  }

  // Adicionar tratamento de erro mais robusto na função updateEbookStatus

  // Função para atualizar o status do ebook
  const updateEbookStatus = async () => {
    if (!currentEbookId) return

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 segundos de timeout

      try {
        const response = await fetch(`/api/ebook?id=${currentEbookId}`, {
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeoutId)
        })

        // Verificar se a resposta é OK
        if (!response.ok) {
          // Tentar obter o texto da resposta para diagnóstico
          let errorMessage = "Failed to fetch ebook status"
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage

            // Se o ebook não foi encontrado, podemos tentar reiniciar o processo
            if (errorData.error === "Ebook not found" && currentStep === 3) {
              console.warn("Ebook não encontrado, voltando para o passo 2")
              setCurrentStep(2)
              setCurrentEbookId(null)
              setEbookState(null)
              setEbookPages([])
              stopPolling()
            }
          } catch (jsonError) {
            // Se não for JSON, tentar obter o texto
            try {
              const errorText = await response.text()
              errorMessage = `${errorMessage}: ${errorText.substring(0, 100)}...`
            } catch (textError) {
              // Se não conseguir obter o texto, usar o status
              errorMessage = `${errorMessage}: Status ${response.status}`
            }
          }
          throw new Error(errorMessage)
        }

        // Tentar fazer o parse do JSON com tratamento de erro
        let data
        try {
          data = await response.json()
        } catch (parseError) {
          console.error("Error parsing ebook status JSON:", parseError)
          // Verificar se parseError é um Error antes de acessar message
          const errorMsg = parseError instanceof Error ? parseError.message : String(parseError)
          throw new Error(`Failed to parse ebook status: ${errorMsg}`)
        }

        // Atualizar o estado
        setEbookState(data.state)
        setEbookPages(data.pages || []) // Garantir que pages seja sempre um array

        // Parar o polling se o estado for final
        if (data.state.status === "completed" || data.state.status === "failed") {
          stopPolling()
          // Se completou, avançar para o passo 4
          if (data.state.status === "completed") {
              setCurrentStep(4)
              setSelectedPageIndex(0) // Selecionar a primeira página por padrão
          }
        }

      } catch (fetchError) {
        // Verificar se fetchError é um Error antes de acessar message
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          console.warn('Fetch aborted (timeout)');
          setError("Timeout ao buscar status do ebook. Verifique sua conexão ou tente novamente.");
        } else {
           console.error("Error fetching ebook status:", fetchError);
           const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
           setError(`Erro ao buscar status do ebook: ${errorMsg}`);
        }
        // Parar o polling em caso de erro de fetch também?
        // stopPolling();
      }
    } catch (error) {
      console.error("Unhandled error in updateEbookStatus:", error)
      // Verificar se error é um Error antes de acessar message
      const errorMsg = error instanceof Error ? error.message : String(error);
      setError(`Erro inesperado ao atualizar status: ${errorMsg}`)
    }
  }

  // Função para iniciar o worker com melhor tratamento de erros
  const startWorker = async (count = 5) => {
    try {
      // Adicionar um timeout para evitar que a requisição fique presa
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 segundos de timeout

      try {
        const response = await fetch(`/api/start-worker?count=${count}`, {
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeoutId)
        })

        // Verificar se a resposta é OK
        if (!response.ok) {
          // Tentar obter o texto da resposta para diagnóstico
          let errorMessage = `Error starting worker: Status ${response.status}`
          try {
            const errorText = await response.text()
            errorMessage = `${errorMessage} - ${errorText.substring(0, 100)}...`
          } catch (textError) {
            // Se não conseguir obter o texto, usar apenas o status
          }
          console.error(errorMessage)
          return false
        }

        // Tentar fazer o parse do JSON com tratamento de erro
        try {
          const data = await response.json()
          console.log("Worker iniciado com sucesso:", data)
          return data.success
        } catch (jsonError) {
          console.error("Error parsing worker response:", jsonError)
          return false
        }
      } catch (fetchError) {
        // Se for um erro de timeout, informar
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          console.warn("Timeout ao iniciar worker, tentando novamente...")
          // Tentar novamente com menos páginas
          return startWorker(Math.max(1, Math.floor(count / 2)))
        }

        // Adicionar log para outros erros de fetch antes de relançar
        console.error("Fetch error in startWorker:", fetchError); 
        throw fetchError // Relançar para ser pego pelo catch externo
      }
    } catch (error) {
      console.error("Error starting worker:", error)
      return false
    }
  }

  // Função para verificar a conexão com o Redis
  const checkRedisConnection = async () => {
    setIsCheckingRedis(true)
    setError(null)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 segundos de timeout

      const response = await fetch("/api/check-redis", {
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeoutId)
      })

      // Verificar se a resposta é OK
      if (!response.ok) {
        // Tentar obter o texto da resposta para diagnóstico
        let errorText = "Erro desconhecido"
        try {
          const errorData = await response.json()
          errorText = errorData.error || `Erro na API: Status ${response.status}`
        } catch (e) {
          try {
            errorText = await response.text()
            errorText = errorText.substring(0, 100) + (errorText.length > 100 ? "..." : "")
          } catch (textError) {
            errorText = `Erro na API: Status ${response.status}`
          }
        }
        throw new Error(errorText)
      }

      // Tentar fazer o parse do JSON com tratamento de erro
      let data
      try {
        data = await response.json()
      } catch (jsonError) {
        throw new Error(`Resposta inválida: ${jsonError instanceof Error ? jsonError.message : "Erro desconhecido"}`)
      }

      // Atualizar o estado com os dados recebidos
      setRedisStatus({
        connected: data.connected,
        redisUrl: data.redisUrl,
        redisToken: data.redisToken,
        envInfo: data.envInfo,
        helpMessage: data.helpMessage,
      })

      // Se não estiver conectado, mostrar erro
      if (!data.connected) {
        setError(`Não foi possível conectar ao Redis. ${data.error || ""}`)

        // Se tiver uma mensagem de ajuda, adicionar ao erro
        if (data.helpMessage) {
          setError((prev) => `${prev}\n\n${data.helpMessage}`)
        }
      }
    } catch (fetchError) {
      console.error("Error fetching redis status:", fetchError);
      // Verificar se fetchError é um Error antes de acessar message
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setError(`Erro ao verificar Redis: ${errorMsg}`);
      setRedisStatus({ connected: false, redisUrl: "N/A", redisToken: "N/A", helpMessage: `Erro: ${errorMsg}` });
    } finally {
      setIsCheckingRedis(false)
    }
  }

  // Função para gerar a descrição (atualizada)
  const handleGenerateDescription = async () => {
    if (!ebookTitle) {
      setError("Por favor, insira um título para o ebook primeiro.");
      return;
    }
    setIsGeneratingDescription(true);
    setError(null);

    try {
      // Chamar a nova API
      const response = await fetch("/api/generate-description", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: ebookTitle }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Falha ao gerar descrição na API.");
      }

      setEbookDescription(data.description);
      setCurrentStep(2);

    } catch (err) {
      console.error("Failed to generate description:", err);
      // Verificar se err é um Error antes de acessar message
      const message = err instanceof Error ? err.message : String(err);
      // Verificar se a mensagem já inclui o erro específico da chave API
      if (message.includes("OpenAI API key is missing")) {
         setError("Erro de configuração: Chave da API OpenAI não encontrada no servidor. Verifique as variáveis de ambiente na Vercel e faça redeploy.");
      } else if (message.includes("Não foi possível gerar a descrição")) {
         // Usar a mensagem de erro vinda da API que já é informativa
         setError(message);
      } else {
         setError(`Erro ao gerar descrição: ${message}`);
      }
      setEbookDescription(""); // Limpar descrição em caso de erro
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  // Atualizar a função handleGenerateFullEbook para incluir o número de páginas
  const handleGenerateFullEbook = async () => {
    if (!ebookTitle.trim() || !ebookDescription.trim()) return

    setError(null)
    setIsGeneratingEbook(true)
    setCurrentStep(3)

    // Registrar o tempo de início
    generationStartTimeRef.current = Date.now()

    // Calcular estimativa inicial de tempo
    const estimatedSecondsPerPage = ESTIMATED_TIME_PER_PAGE[contentMode as keyof typeof ESTIMATED_TIME_PER_PAGE] || 20
    const initialEstimate = Math.ceil((pageCount * estimatedSecondsPerPage) / 60)
    setEstimatedTimeRemaining(`${initialEstimate} minutos restantes`)

    try {
      // Criar o ebook na API
      const response = await fetch("/api/ebook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: ebookTitle,
          description: ebookDescription,
          contentMode,
          pageCount, // Adicionar o número de páginas à requisição
        }),
      })

      // Verificar se a resposta é OK
      if (!response.ok) {
        // Tentar obter o texto da resposta para diagnóstico
        let errorMessage = `Erro do servidor: ${response.status}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
        } catch (jsonError) {
          // Se não for JSON, tentar obter o texto
          try {
            const errorText = await response.text()
            errorMessage = `${errorMessage} - ${errorText.substring(0, 100)}...`
          } catch (textError) {
            // Se não conseguir obter o texto, usar apenas o status
          }
        }
        throw new Error(errorMessage)
      }

      // Tentar fazer o parse do JSON com tratamento de erro
      let data
      try {
        data = await response.json()
      } catch (jsonError) {
        throw new Error(
          `Resposta inválida do servidor: ${jsonError instanceof Error ? jsonError.message : "Erro desconhecido"}`,
        )
      }

      if (data.success) {
        setCurrentEbookId(data.ebookId)
        setEbookState(data.state)

        // Iniciar o worker para processar a fila
        await startWorker(10)

        // Iniciar o polling para atualizar o status
        startPolling()
      } else {
        throw new Error(data.error || "Falha ao criar ebook")
      }
    } catch (error) {
      console.error("Failed to generate ebook:", error)
      setError(error instanceof Error ? error.message : "Erro ao gerar o ebook completo.")
      setCurrentStep(2)
    } finally {
      setIsGeneratingEbook(false)
    }
  }

  // Função para baixar o ebook
  const handleDownloadEbook = () => {
    // Log para verificar se a função é chamada
    console.log("handleDownloadEbook called. Ebook ID:", currentEbookId);

    if (!currentEbookId) {
      setError("Não há ID de ebook atual para baixar.");
      return;
    }
    // Construir a URL de download
    const downloadUrl = `/api/ebook/${currentEbookId}/download`;
    console.log("Attempting to download from:", downloadUrl);

    // Iniciar o download (forma simples via navegação)
    // Isso deve funcionar, mas não registra uma entrada óbvia no Network as vezes
    // como um fetch, mas o download deve iniciar.
    window.location.href = downloadUrl;

    // Alternativa (menos comum para downloads diretos):
    // fetch(downloadUrl)
    //  .then(response => {
    //    if (!response.ok) throw new Error('Download failed');
    //    // ... (lógica mais complexa para criar blob e link, geralmente não necessária)
    //  })
    //  .catch(err => {
    //    console.error("Download fetch error:", err);
    //    setError("Falha ao iniciar o download.");
    //  });
  }

  // Função para forçar a atualização do status
  const handleRefreshStatus = () => {
    updateEbookStatus()
  }

  // Função para continuar o processamento
  const handleContinueProcessing = async () => {
    if (!currentEbookId) return

    try {
      // Iniciar o worker para processar mais itens da fila
      await startWorker(10)

      // Iniciar o polling para atualizar o status
      startPolling()
    } catch (error) {
      console.error("Error continuing processing:", error)
      setError(error instanceof Error ? error.message : "Erro ao continuar o processamento")
    }
  }

  // Função para salvar o ebook na biblioteca
  const handleSaveToLibrary = async () => {
    if (!ebookState || ebookPages.length === 0) return

    try {
      // Ordenar as páginas por índice
      const sortedPages = [...ebookPages].sort((a, b) => a.index - b.index)

      // Criar o objeto do ebook para salvar
      const ebookToSave = {
        id: currentEbookId,
        title: ebookState.title,
        description: ebookState.description,
        contentMode: ebookState.contentMode,
        totalPages: ebookState.totalPages,
        completedPages: ebookState.completedPages,
        status: ebookState.status,
        createdAt: ebookState.createdAt,
        pages: sortedPages.map((page) => ({
          index: page.index,
          content: page.content,
        })),
      }

      // Salvar o ebook na API
      const response = await fetch("/api/biblioteca", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ebookToSave),
      })

      if (!response.ok) {
        throw new Error(`Erro ao salvar ebook: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        // Mostrar mensagem de sucesso
        alert("Ebook salvo na biblioteca com sucesso!")
      } else {
        throw new Error(data.error || "Falha ao salvar ebook")
      }
    } catch (error) {
      console.error("Error saving ebook to library:", error)
      setError(error instanceof Error ? error.message : "Erro ao salvar ebook na biblioteca")
    }
  }

  // Preparar dados para o componente de páginas
  const preparePageData = () => {
    if (!ebookState) return []

    // Criar um array de páginas com base no total de páginas do ebook
    return Array.from({ length: ebookState.totalPages }, (_, i) => {
      // Encontrar a página correspondente nos dados recebidos
      const page = ebookPages.find((p) => p.index === i)
      return {
        index: i,
        content: page?.content || "",
        isGenerated: !!page,
      }
    })
  }

  // Preparar dados para páginas em processamento e na fila
  const prepareProcessingAndQueuedPages = () => {
    if (!ebookState) return { processingPages: [], queuedPages: [] }

    const processingPages = []
    const queuedPages = []

    // Calcular quais páginas estão em processamento e quais estão na fila
    for (let i = 0; i < ebookState.totalPages; i++) {
      const page = ebookPages.find((p) => p.index === i)
      if (!page) {
        if (i < ebookState.totalPages - ebookState.queuedPages - ebookState.failedPages) {
          processingPages.push(i)
        } else {
          queuedPages.push(i)
        }
      }
    }

    return { processingPages, queuedPages }
  }

  // Renderizar o passo 1: Nome do Ebook
  const renderStep1 = () => {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Nome do Ebook</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ebook-title" className="font-medium">Título do Ebook</Label>
              <Input
                id="ebook-title"
                placeholder="Ex: Guia Completo de Marketing Digital"
                value={ebookTitle}
                onChange={(e) => setEbookTitle(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleGenerateDescription}
            disabled={!ebookTitle.trim() || isGeneratingDescription}
            className="w-full"
          >
            {isGeneratingDescription ? (
              <SimpleLoading text="Gerando descrição..." />
            ) : (
              <>
                <ArrowRight className="mr-2 h-4 w-4" />
                Próximo: Gerar Descrição
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  // Renderizar o passo 2: Descrição do Ebook
  const renderStep2 = () => {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Configuração do Ebook</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="ebook-description" className="font-medium">Descrição do Ebook</Label>
              <Textarea
                id="ebook-description"
                className="min-h-[150px]"
                placeholder="Descreva o conteúdo do seu ebook..."
                value={ebookDescription}
                onChange={(e) => setEbookDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Seletor de quantidade de páginas */}
              <div className="space-y-2">
                <Label htmlFor="page-count" className="font-medium">Quantidade de Páginas</Label>
                <Select value={pageCount.toString()} onValueChange={(value) => setPageCount(Number(value))}>
                  <SelectTrigger id="page-count">
                    <SelectValue placeholder="Selecione a quantidade de páginas" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_COUNT_OPTIONS.map((count) => (
                      <SelectItem key={count} value={count.toString()}>
                        {count} páginas
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Seletor de densidade de conteúdo */}
              <div className="space-y-2">
                <Label htmlFor="content-mode" className="font-medium">Densidade de Conteúdo</Label>
                <Select value={contentMode} onValueChange={setContentMode}>
                  <SelectTrigger id="content-mode">
                    <SelectValue placeholder="Selecione a densidade de conteúdo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL">Completo (mais detalhado)</SelectItem>
                    <SelectItem value="MEDIUM">Médio (equilibrado)</SelectItem>
                    <SelectItem value="MINIMAL">Mínimo (menos detalhado)</SelectItem>
                    <SelectItem value="ULTRA_MINIMAL">Ultra-mínimo (básico)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => setCurrentStep(1)}>
            Voltar
          </Button>
          <Button onClick={handleGenerateFullEbook} disabled={!ebookDescription.trim() || isGeneratingEbook}>
            {isGeneratingEbook ? (
              <SimpleLoading text="Iniciando geração..." />
            ) : (
              <>
                <BookText className="mr-2 h-4 w-4" />
                Gerar Ebook
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  // Renderizar o passo 3: Geração do Ebook
  const renderStep3 = () => {
    const { processingPages, queuedPages } = prepareProcessingAndQueuedPages()
    const pages = preparePageData()

    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Gerando seu Ebook</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {ebookState ? (
              <GenerationStatus
                progress={Math.round((ebookState.completedPages / ebookState.totalPages) * 100)}
                stats={{
                  processing: ebookState.processingPages,
                  queued: ebookState.queuedPages,
                  completed: ebookState.completedPages,
                  failed: ebookState.failedPages,
                  total: ebookState.totalPages,
                }}
                estimatedTime={estimatedTimeRemaining}
              />
            ) : (
              <div className="flex justify-center py-4">
                <SimpleLoading text="Iniciando geração do ebook..." />
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={handleRefreshStatus}>
                <RefreshCw className="mr-1 h-4 w-4" />
                Atualizar Status
              </Button>

              <Button variant="outline" size="sm" onClick={handleContinueProcessing}>
                <Database className="mr-1 h-4 w-4" />
                Continuar Processamento
              </Button>
            </div>

            {ebookState && (
              <PageViewer
                pages={pages}
                processingPages={processingPages}
                queuedPages={queuedPages}
                onSelectPage={setSelectedPageIndex}
                selectedPageIndex={selectedPageIndex}
              />
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Renderizar o passo 4: Ebook Completo
  const renderStep4 = () => {
    const pages = preparePageData()

    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>
            {ebookState?.status === "completed"
              ? "Ebook Gerado com Sucesso"
              : ebookState?.status === "partial"
                ? "Ebook Gerado Parcialmente"
                : "Falha na Geração do Ebook"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {ebookState && (
              <div className="border p-4 rounded-md mb-4">
                <p className="font-medium">{ebookState.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{ebookState.description}</p>
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span>
                    {ebookState.completedPages} de {ebookState.totalPages} páginas geradas
                    {ebookState.failedPages > 0 && ` (${ebookState.failedPages} com falha)`}
                  </span>
                </div>
              </div>
            )}

            <PageViewer pages={pages} onSelectPage={setSelectedPageIndex} selectedPageIndex={selectedPageIndex} />
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => setCurrentStep(1)}>
            Criar Novo Ebook
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSaveToLibrary} disabled={!ebookState || ebookPages.length === 0}>
              <Library className="mr-2 h-4 w-4" />
              Salvar na Biblioteca
            </Button>
            <Button onClick={handleDownloadEbook} disabled={!ebookState || ebookPages.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Baixar Ebook
            </Button>
          </div>
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-medium mb-6">Gerador de Ebook</h1>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
        </Alert>
      )}

      {/* Indicador de progresso dos passos */}
      <StepIndicator steps={STEPS} currentStep={currentStep} className="mb-6" />

      {/* Renderizar o passo atual */}
      <div className="max-w-3xl mx-auto">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
      </div>
    </div>
  )
}
