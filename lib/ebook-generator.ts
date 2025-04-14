import { generateText, streamText } from "ai"
import { openai } from "@ai-sdk/openai"

// Configurações globais
const TIMEOUT_MS = 15000 // Reduzido para 15 segundos
const MAX_RETRIES = 4
const MAX_TOKENS_PER_PAGE = 300 // Reduzido significativamente
const CONCURRENT_GENERATIONS = 2 // Reduzido para 2 páginas simultâneas
const BACKOFF_MULTIPLIER = 1.5 // Multiplicador para backoff exponencial

// Configuração de chunks
const CHUNK_SIZE = 150 // Tamanho de cada chunk em tokens
const CHUNKS_PER_PAGE = 3 // Número de chunks por página (ajustável por modo)

// Configurações de conteúdo
const CONTENT_MODES = {
  FULL: {
    name: "Completo",
    maxTokens: 600,
    chunksPerPage: 4,
    promptSuffix: "Escreva um conteúdo detalhado com aproximadamente 400-500 palavras.",
    estimatedSecondsPerPage: 30,
  },
  MEDIUM: {
    name: "Médio",
    maxTokens: 450,
    chunksPerPage: 3,
    promptSuffix: "Escreva um conteúdo conciso com aproximadamente 250-300 palavras.",
    estimatedSecondsPerPage: 20,
  },
  MINIMAL: {
    name: "Mínimo",
    maxTokens: 300,
    chunksPerPage: 2,
    promptSuffix: "Escreva um conteúdo breve com aproximadamente 150-200 palavras.",
    estimatedSecondsPerPage: 15,
  },
  ULTRA_MINIMAL: {
    name: "Ultra-mínimo",
    maxTokens: 150,
    chunksPerPage: 1,
    promptSuffix: "Escreva apenas um parágrafo curto com aproximadamente 50-100 palavras.",
    estimatedSecondsPerPage: 10,
  },
}

// Modo de conteúdo padrão
let CONTENT_MODE = CONTENT_MODES.MEDIUM

export function setContentMode(mode: keyof typeof CONTENT_MODES) {
  CONTENT_MODE = CONTENT_MODES[mode]
  return CONTENT_MODE
}

export function getContentModes() {
  return Object.keys(CONTENT_MODES)
}

export function getCurrentContentMode() {
  return Object.entries(CONTENT_MODES).find(([_, config]) => config === CONTENT_MODE)?.[0] || "MEDIUM"
}

export async function generateEbookDescription(title: string): Promise<string> {
  // Log para depuração
  console.log("generateEbookDescription called.");
  console.log("OpenAI API Key defined?", !!process.env.OPENAI_API_KEY);
  // Se quiser ver os primeiros/últimos caracteres da chave (NÃO LOGUE A CHAVE INTEIRA):
  // if (process.env.OPENAI_API_KEY) {
  //   console.log("API Key starts/ends with:", process.env.OPENAI_API_KEY.substring(0, 5) + "..." + process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 4));
  // }

  try {
    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt: `Crie uma descrição breve e atraente para um ebook com o título "${title}". 
      A descrição deve ter entre 100 e 150 palavras e explicar o que o leitor vai aprender, 
      para quem o ebook é destinado e quais são os principais benefícios de lê-lo.`,
      maxTokens: 300,
    })

    return text
  } catch (error) {
    console.error("Error generating ebook description:", error)
    throw new Error(
      "Não foi possível gerar a descrição do ebook. Verifique se a chave da API está configurada corretamente.",
    )
  }
}

export type GenerationStep = {
  type: "toc" | "page" | "complete" | "error" | "queue-update" | "mode-change" | "chunk-update"
  content: string
  progress: number // 0-100
  pageInfo?: {
    current: number
    total: number
    title: string
    chunkInfo?: {
      current: number
      total: number
    }
  }
  allPages?: EbookPage[]
  error?: string
  queueStatus?: {
    inProgress: number[]
    waiting: number[]
    completed: number[]
    failed: number[]
  }
  contentMode?: string
}

export type EbookPage = {
  id: number
  title: string
  content: string
  isGenerated: boolean
  isGenerating?: boolean
  isQueued?: boolean
  error?: string
  retryCount?: number
  chunks?: string[] // Para armazenar partes do conteúdo
  completedChunks?: number // Número de chunks concluídos
  totalChunks?: number // Número total de chunks
}

export type EbookStructure = {
  title: string
  description: string
  pages: EbookPage[]
}

// Cache para armazenar conteúdo parcial
const pageContentCache: Record<string, string> = {}
const chunkContentCache: Record<string, string[]> = {}

// Função para gerar a estrutura do ebook (sumário e páginas)
export async function generateEbookStructure(
  title: string,
  description: string,
  pageCount: number,
  onProgress: (step: GenerationStep) => void,
): Promise<EbookStructure> {
  try {
    // Gerar o sumário
    onProgress({
      type: "toc",
      content: "Gerando estrutura do ebook...",
      progress: 5,
    })

    const { text: structureText } = await generateText({
      model: openai("gpt-4o"),
      prompt: `Crie uma estrutura simples para um ebook de exatamente ${pageCount} páginas com o título \"${title}\" e a seguinte descrição:
      
      \"${description}\"
      
      Forneça uma lista numerada de exatamente ${pageCount} páginas, cada uma com um título específico e curto.
      
      As primeiras páginas devem ser dedicadas à introdução.
      As páginas do meio devem cobrir o conteúdo principal, dividido em capítulos lógicos.
      As últimas páginas devem ser dedicadas à conclusão e considerações finais.
      
      Cada título deve ser específico e descrever exatamente o que será abordado naquela página.
      
      Formato esperado:
      1. [Título da Página 1]
      2. [Título da Página 2]
      ...
      ${pageCount}. [Título da Página ${pageCount}]`,
      maxTokens: 1000 + pageCount * 10,
    })

    // Extrair os títulos das páginas
    const pageRegex = /\d+\.\s*(.+?)(?=\n|$)/g
    const pages: EbookPage[] = []
    let match

    // Limitar a extração ao pageCount desejado
    while ((match = pageRegex.exec(structureText)) !== null && pages.length < pageCount) {
      if (match[1] && match[1].trim()) {
        pages.push({
          id: pages.length + 1,
          title: match[1].trim(),
          content: "",
          isGenerated: false,
          chunks: [],
          completedChunks: 0,
          totalChunks: CONTENT_MODE.chunksPerPage || CHUNKS_PER_PAGE,
        })
      }
    }

    // Se não encontrou páginas suficientes, criar páginas genéricas até atingir pageCount
    if (pages.length < pageCount) {
      console.warn(`IA gerou ${pages.length} títulos, esperado ${pageCount}. Completando com títulos genéricos.`);
      const genericTitles = [
        "Introdução ao Tema",
        "Contexto Histórico",
        "Conceitos Fundamentais",
        "Principais Desafios",
        "Estratégias Eficazes",
        "Aplicações Práticas",
        "Estudos de Caso",
        "Ferramentas e Recursos",
        "Tendências Futuras",
        "Considerações Finais",
      ]

      while (pages.length < pageCount) {
        const genericIndex = (pages.length - (pageCount - genericTitles.length)) % genericTitles.length;
        const fallbackTitle = genericTitles[genericIndex >= 0 ? genericIndex : 0] || `Página ${pages.length + 1}`;
        pages.push({
          id: pages.length + 1,
          title: `${fallbackTitle} (Placeholder)`,
          content: "",
          isGenerated: false,
          chunks: [],
          completedChunks: 0,
          totalChunks: CONTENT_MODE.chunksPerPage || CHUNKS_PER_PAGE,
        });
      }
    }

    // Limitar a exatamente pageCount páginas
    const finalPages = pages.slice(0, pageCount)

    onProgress({
      type: "toc",
      content: finalPages.map((page) => `${page.id}. ${page.title}`).join("\n"),
      progress: 10,
      allPages: finalPages,
    })

    return {
      title,
      description,
      pages: finalPages,
    }
  } catch (error) {
    console.error("Error generating ebook structure:", error)
    onProgress({
      type: "error",
      content: "Erro ao gerar a estrutura do ebook",
      progress: 0,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    })
    throw new Error("Não foi possível gerar a estrutura do ebook.")
  }
}

// Função para gerar um chunk específico de uma página
async function generatePageChunk(
  ebookStructure: EbookStructure,
  pageIndex: number,
  chunkIndex: number,
  previousChunks: string[],
  onProgress: (content: string) => void,
): Promise<string> {
  const page = ebookStructure.pages[pageIndex]
  const cacheKey = `${ebookStructure.title}-${page.id}-chunk-${chunkIndex}`

  // Verificar se temos o chunk em cache
  if (pageContentCache[cacheKey] && pageContentCache[cacheKey].length > 20) {
    onProgress(`[Recuperado do cache] ${pageContentCache[cacheKey]}`)
    return pageContentCache[cacheKey]
  }

  // Criar o prompt para o chunk
  const createChunkPrompt = () => {
    const isFirstChunk = chunkIndex === 0
    const isLastChunk = chunkIndex === (page.totalChunks || CHUNKS_PER_PAGE) - 1

    let contextPrompt = ""
    if (!isFirstChunk && previousChunks.length > 0) {
      contextPrompt = `
      Aqui está o conteúdo já gerado para esta página:
      
      ${previousChunks.join("\n\n")}
      
      Continue a partir deste ponto, mantendo a coerência e o fluxo do texto.`
    }

    let instructionPrompt = ""
    if (isFirstChunk) {
      instructionPrompt = "Comece a página com uma introdução ao tema."
    } else if (isLastChunk) {
      instructionPrompt = "Conclua o conteúdo da página com um fechamento adequado."
    } else {
      instructionPrompt = "Continue desenvolvendo o conteúdo da página."
    }

    return `Você está escrevendo a parte ${chunkIndex + 1} de ${page.totalChunks || CHUNKS_PER_PAGE} da página ${
      page.id
    } de um ebook com o título "${ebookStructure.title}".
    
    Título desta página: "${page.title}"
    
    ${contextPrompt}
    
    ${instructionPrompt}
    
    Escreva APENAS esta parte do conteúdo, com aproximadamente ${CHUNK_SIZE} tokens.
    O texto deve ser informativo, relevante e escrito em português do Brasil com linguagem clara.
    Não inclua o título ou número da página no texto.`
  }

  // Função para tentar gerar o chunk com retry
  const attemptChunkGeneration = async (retryCount = 0): Promise<string> => {
    try {
      // Calcular o timeout com backoff exponencial
      const adjustedTimeout = Math.min(
        TIMEOUT_MS * Math.pow(BACKOFF_MULTIPLIER, retryCount),
        30000, // Máximo de 30 segundos
      )

      // Criar um timeout para a requisição
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout ao gerar o chunk")), adjustedTimeout)
      })

      // Criar a promessa de geração do chunk
      const generationPromise = new Promise<string>(async (resolve) => {
        let chunkContent = pageContentCache[cacheKey] || ""

        // Reduzir o tamanho do prompt em retentativas
        const maxTokens = Math.max(CHUNK_SIZE - retryCount * 30, 80)

        const chunkStream = streamText({
          model: openai("gpt-4o"),
          prompt: createChunkPrompt(),
          maxTokens,
          onChunk: ({ chunk }) => {
            if (typeof chunk === 'object' && chunk !== null && 'type' in chunk && chunk.type === "text-delta" && 'text' in chunk && typeof chunk.text === 'string') {
              chunkContent += chunk.text
              // Atualizar o cache em tempo real
              pageContentCache[cacheKey] = chunkContent
              onProgress(chunkContent)
            } else if (typeof chunk === 'string') {
              chunkContent += chunk;
              pageContentCache[cacheKey] = chunkContent
              onProgress(chunkContent)
            }
          },
        })

        try {
          await chunkStream.text
          resolve(chunkContent)
        } catch (error) {
          // Se falhar no streaming, mas já temos conteúdo suficiente, retornamos o que temos
          if (chunkContent.length > 50) {
            console.warn("Stream failed but we have enough content, continuing:", error)
            resolve(chunkContent)
          } else {
            throw error
          }
        }
      })

      // Competição entre timeout e geração
      return await Promise.race([generationPromise, timeoutPromise])
    } catch (error) {
      console.error(`Error generating chunk ${chunkIndex + 1} for page ${page.id} (attempt ${retryCount + 1}):`, error)

      // Se ainda temos tentativas, tentar novamente
      if (retryCount < MAX_RETRIES) {
        // Calcular tempo de espera com backoff exponencial
        const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 5000) // Máximo de 5 segundos

        onProgress(`Tentativa ${retryCount + 1} falhou. Aguardando ${backoffTime / 1000}s antes de tentar novamente...`)

        // Esperar um pouco antes de tentar novamente (backoff exponencial)
        await new Promise((resolve) => setTimeout(resolve, backoffTime))

        return attemptChunkGeneration(retryCount + 1)
      }

      // Se esgotamos as tentativas, verificar se temos conteúdo em cache
      if (pageContentCache[cacheKey] && pageContentCache[cacheKey].length > 20) {
        onProgress("Usando conteúdo parcial do cache após falhas...")
        return pageContentCache[cacheKey]
      }

      // Se não temos cache, gerar um conteúdo de fallback ultra simplificado
      try {
        const { text: fallbackContent } = await generateText({
          model: openai("gpt-4o"),
          prompt: `Escreva um parágrafo curto sobre "${page.title}" para a parte ${chunkIndex + 1} da página.`,
          maxTokens: 80,
        })

        return fallbackContent
      } catch (fallbackError) {
        // Se até o fallback falhar, retornar uma mensagem genérica
        return `[Esta parte do conteúdo não pôde ser gerada devido a limitações técnicas.]`
      }
    }
  }

  // Iniciar a tentativa de geração
  return attemptChunkGeneration()
}

// Função para gerar uma página específica usando o sistema de chunks
export async function generateEbookPage(
  ebookStructure: EbookStructure,
  pageIndex: number,
  onProgress: (content: string, chunkInfo?: { current: number; total: number }) => void,
  onError: (error: string) => void,
): Promise<string> {
  const page = ebookStructure.pages[pageIndex]
  const cacheKey = `${ebookStructure.title}-${page.id}`

  // Definir o número total de chunks para esta página
  const totalChunks = page.totalChunks || CONTENT_MODE.chunksPerPage || CHUNKS_PER_PAGE
  page.totalChunks = totalChunks

  // Verificar se temos conteúdo completo em cache
  if (pageContentCache[cacheKey] && pageContentCache[cacheKey].length > 200) {
    onProgress(`[Recuperado do cache] ${pageContentCache[cacheKey]}`)
    return pageContentCache[cacheKey]
  }

  // Inicializar ou recuperar o array de chunks
  if (!chunkContentCache[cacheKey]) {
    chunkContentCache[cacheKey] = []
  }

  const allChunks = chunkContentCache[cacheKey]

  try {
    // Gerar cada chunk sequencialmente
    for (let i = 0; i < totalChunks; i++) {
      // Verificar se já temos este chunk
      if (allChunks[i] && allChunks[i].length > 50) {
        onProgress(allChunks.join("\n\n"), { current: i + 1, total: totalChunks })
        continue
      }

      // Atualizar o progresso
      onProgress(`Gerando parte ${i + 1} de ${totalChunks}...${allChunks.join("\n\n")}`, {
        current: i + 1,
        total: totalChunks,
      })

      // Gerar o chunk
      const chunkContent = await generatePageChunk(ebookStructure, pageIndex, i, allChunks, (content) => {
        // Atualizar temporariamente o último chunk
        const tempChunks = [...allChunks]
        tempChunks[i] = content
        onProgress(tempChunks.join("\n\n"), { current: i + 1, total: totalChunks })
      })

      // Adicionar o chunk ao array
      allChunks[i] = chunkContent
      chunkContentCache[cacheKey] = allChunks
      page.chunks = allChunks
      page.completedChunks = i + 1

      // Atualizar o progresso
      onProgress(allChunks.join("\n\n"), { current: i + 1, total: totalChunks })
    }

    // Combinar todos os chunks
    const fullContent = allChunks.join("\n\n")

    // Atualizar o cache
    pageContentCache[cacheKey] = fullContent

    return fullContent
  } catch (error) {
    console.error(`Error generating page ${page.id}:`, error)

    // Se temos alguns chunks, retornar o que temos
    if (allChunks.length > 0) {
      const partialContent = allChunks.join("\n\n")
      onError(
        `Geração parcial da página ${page.id} devido a erro: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
      )
      return `${partialContent}\n\n[Conteúdo parcial devido a limitações técnicas]`
    }

    // Se não temos nenhum chunk, gerar um conteúdo de fallback
    onError(
      `Não foi possível gerar a página ${page.id}: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
    )

    try {
      const { text: fallbackContent } = await generateText({
        model: openai("gpt-4o"),
        prompt: `Escreva um parágrafo curto sobre "${page.title}" para um ebook intitulado "${ebookStructure.title}".`,
        maxTokens: 100,
      })

      return `[Esta página foi gerada com conteúdo mínimo devido a limitações técnicas]\n\n${fallbackContent}\n\n[Para obter o conteúdo completo, tente gerar o ebook novamente mais tarde]`
    } catch (fallbackError) {
      // Se até o fallback falhar, retornar uma mensagem genérica
      return `[Esta página não pôde ser gerada devido a limitações técnicas. O título desta página é "${page.title}" e faz parte do ebook "${ebookStructure.title}"]`
    }
  }
}

// Função principal para gerar o ebook completo com páginas em paralelo
export async function generateFullEbookWithProgress(
  title: string,
  description: string,
  onProgress: (step: GenerationStep) => void,
  contentMode: keyof typeof CONTENT_MODES = "MEDIUM",
): Promise<EbookStructure> {
  try {
    // Definir o modo de conteúdo
    const mode = setContentMode(contentMode)
    onProgress({
      type: "mode-change",
      content: `Modo de conteúdo definido para: ${mode.name}`,
      progress: 0,
      contentMode: contentMode,
    })

    // Gerar a estrutura do ebook
    const ebookStructure = await generateEbookStructure(title, description, 30, onProgress)
    const totalPages = ebookStructure.pages.length

    // Inicializar filas
    const queue: number[] = Array.from({ length: totalPages }, (_, i) => i) // Índices de todas as páginas
    const inProgress: number[] = [] // Páginas sendo geradas
    const completed: number[] = [] // Páginas concluídas
    const failed: number[] = [] // Páginas com erro

    // Função para atualizar o status da fila
    const updateQueueStatus = () => {
      // Calcular o progresso geral (10% para estrutura + 90% para páginas)
      const pagesProgress = (completed.length / totalPages) * 90
      const totalProgress = 10 + pagesProgress

      // Encontrar a página atual para exibição (a primeira em progresso ou a última concluída)
      const currentPageIndex =
        inProgress.length > 0 ? inProgress[0] : completed.length > 0 ? completed[completed.length - 1] : 0
      const currentPage = ebookStructure.pages[currentPageIndex]

      // Atualizar o status da fila
      onProgress({
        type: "queue-update",
        content: `Gerando ${inProgress.length} páginas simultaneamente. ${completed.length} de ${totalPages} concluídas.`,
        progress: totalProgress,
        pageInfo: currentPage
          ? {
              current: currentPage.id,
              total: totalPages,
              title: currentPage.title,
              chunkInfo: {
                current: currentPage.completedChunks || 0,
                total: currentPage.totalChunks || CHUNKS_PER_PAGE,
              },
            }
          : undefined,
        allPages: ebookStructure.pages,
        queueStatus: {
          inProgress: inProgress.map((i) => ebookStructure.pages[i].id),
          waiting: queue.map((i) => ebookStructure.pages[i].id),
          completed: completed.map((i) => ebookStructure.pages[i].id),
          failed: failed.map((i) => ebookStructure.pages[i].id),
        },
      })
    }

    // Função para processar a próxima página da fila
    const processNextPage = async () => {
      if (queue.length === 0) return

      // Pegar o próximo item da fila
      const pageIndex = queue.shift()!
      inProgress.push(pageIndex)

      // Marcar a página como "gerando"
      ebookStructure.pages[pageIndex].isGenerating = true
      ebookStructure.pages[pageIndex].isQueued = false
      ebookStructure.pages[pageIndex].retryCount = 0
      ebookStructure.pages[pageIndex].completedChunks = 0
      ebookStructure.pages[pageIndex].totalChunks = CONTENT_MODE.chunksPerPage || CHUNKS_PER_PAGE

      // Atualizar o status da fila
      updateQueueStatus()

      try {
        // Gerar o conteúdo da página
        const pageContent = await generateEbookPage(
          ebookStructure,
          pageIndex,
          (content, chunkInfo) => {
            // Atualizar o conteúdo da página em tempo real
            ebookStructure.pages[pageIndex].content = content

            // Atualizar informações de chunks
            if (chunkInfo) {
              ebookStructure.pages[pageIndex].completedChunks = chunkInfo.current
              ebookStructure.pages[pageIndex].totalChunks = chunkInfo.total

              // Notificar sobre atualização de chunk
              onProgress({
                type: "chunk-update",
                content: `Gerando parte ${chunkInfo.current} de ${chunkInfo.total} da página ${ebookStructure.pages[pageIndex].id}`,
                progress: 10 + (completed.length / totalPages) * 90,
                pageInfo: {
                  current: ebookStructure.pages[pageIndex].id,
                  total: totalPages,
                  title: ebookStructure.pages[pageIndex].title,
                  chunkInfo,
                },
                allPages: ebookStructure.pages,
              })
            }

            updateQueueStatus()
          },
          (error) => {
            // Registrar o erro na página
            ebookStructure.pages[pageIndex].error = error
            onProgress({
              type: "error",
              content: error,
              progress: 10 + (completed.length / totalPages) * 90,
              pageInfo: {
                current: ebookStructure.pages[pageIndex].id,
                total: totalPages,
                title: ebookStructure.pages[pageIndex].title,
              },
              allPages: ebookStructure.pages,
            })
          },
        )

        // Atualizar o conteúdo final da página
        ebookStructure.pages[pageIndex].content = pageContent
        ebookStructure.pages[pageIndex].isGenerated = true
        ebookStructure.pages[pageIndex].isGenerating = false
        ebookStructure.pages[pageIndex].completedChunks = ebookStructure.pages[pageIndex].totalChunks

        // Mover da lista "em progresso" para "concluídas"
        inProgress.splice(inProgress.indexOf(pageIndex), 1)
        completed.push(pageIndex)

        // Atualizar o status da fila
        updateQueueStatus()

        // Processar a próxima página
        return processNextPage()
      } catch (error) {
        console.error(`Failed to generate page ${pageIndex + 1}:`, error)

        // Marcar a página como com erro
        ebookStructure.pages[pageIndex].isGenerating = false
        ebookStructure.pages[pageIndex].isGenerated = true // Marcamos como gerada para não travar
        ebookStructure.pages[pageIndex].error = error instanceof Error ? error.message : "Erro desconhecido"

        // Mover da lista "em progresso" para "falhas"
        inProgress.splice(inProgress.indexOf(pageIndex), 1)
        failed.push(pageIndex)

        // Atualizar o status da fila
        updateQueueStatus()

        // Processar a próxima página
        return processNextPage()
      }
    }

    // Marcar todas as páginas como "na fila"
    ebookStructure.pages.forEach((page) => {
      page.isQueued = true
      page.totalChunks = CONTENT_MODE.chunksPerPage || CHUNKS_PER_PAGE
      page.completedChunks = 0
    })

    // Iniciar o processamento paralelo
    const parallelProcessing = []
    for (let i = 0; i < Math.min(CONCURRENT_GENERATIONS, totalPages); i++) {
      parallelProcessing.push(processNextPage())
    }

    // Aguardar a conclusão de todas as páginas
    await Promise.all(parallelProcessing)

    // Notificar conclusão
    onProgress({
      type: "complete",
      content: "Ebook completo gerado com sucesso!",
      progress: 100,
      allPages: ebookStructure.pages,
    })

    return ebookStructure
  } catch (error) {
    console.error("Error generating full ebook:", error)
    onProgress({
      type: "error",
      content: "Erro ao gerar o ebook completo",
      progress: 0,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    })
    throw new Error(
      "Não foi possível gerar o ebook completo. Verifique se a chave da API está configurada corretamente.",
    )
  }
}

// Função para converter a estrutura do ebook em texto
export function ebookStructureToText(ebookStructure: EbookStructure): string[] {
  const sections: string[] = []

  // Adicionar título e descrição
  sections.push(`# ${ebookStructure.title}`)
  sections.push(ebookStructure.description)

  // Adicionar cada página
  ebookStructure.pages.forEach((page) => {
    sections.push(`## Página ${page.id}: ${page.title}`)
    sections.push(page.content || "[Conteúdo não gerado]")
  })

  return sections
}

// Manter a função antiga para compatibilidade
export async function generateFullEbook(title: string, description: string): Promise<string[]> {
  let result: string[] = []

  const ebookStructure = await generateFullEbookWithProgress(title, description, (step) => {
    if (step.type === "complete" && step.allPages) {
      const pages = step.allPages
      result = ebookStructureToText({
        title,
        description,
        pages,
      })
    }
  })

  return result
}
