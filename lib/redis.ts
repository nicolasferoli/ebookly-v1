import { Redis } from "@upstash/redis"

// Verificar se as variáveis de ambiente estão definidas
// Priorizar a URL da API REST (KV_REST_API_URL) sobre as URLs de conexão direta
const redisUrl = process.env.KV_REST_API_URL || process.env.REDIS_URL || process.env.KV_URL || ""
const redisToken =
  process.env.KV_REST_API_TOKEN || process.env.REDIS_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || ""

// Criar cliente Redis apenas se as variáveis de ambiente estiverem definidas
let redis: Redis | null = null

try {
  if (redisUrl && redisToken) {
    // Verificar se a URL está no formato correto (https://)
    if (redisUrl.startsWith("https://")) {
      console.log("Inicializando cliente Redis com URL da API REST")
      redis = new Redis({
        url: redisUrl,
        token: redisToken,
      })
    } else {
      // Se a URL não estiver no formato correto, verificar se temos a URL da API REST disponível
      if (process.env.KV_REST_API_URL) {
        console.log("Usando KV_REST_API_URL em vez da URL fornecida")
        redis = new Redis({
          url: process.env.KV_REST_API_URL,
          token: redisToken,
        })
      } else {
        // Se não tivermos a URL da API REST, tentar extrair o hostname da URL de conexão direta
        try {
          const urlObj = new URL(redisUrl)
          const hostname = urlObj.hostname
          if (hostname.includes("upstash.io")) {
            const restUrl = `https://${hostname}`
            console.log(`Convertendo URL de conexão direta para API REST: ${restUrl}`)
            redis = new Redis({
              url: restUrl,
              token: redisToken,
            })
          } else {
            throw new Error("Não foi possível determinar a URL da API REST a partir da URL de conexão")
          }
        } catch (urlError) {
          console.error("Erro ao analisar URL do Redis:", urlError)
          throw new Error(
            "A URL do Redis está em um formato incompatível. O cliente Upstash Redis requer uma URL da API REST que comece com https://.",
          )
        }
      }
    }
  } else {
    console.warn(
      "Variáveis de ambiente do Redis não estão definidas. A funcionalidade do Redis não funcionará corretamente.",
    )
  }
} catch (error) {
  console.error("Falha ao inicializar o cliente Redis:", error)
}

// Modificar a função checkRedisConnection para corrigir o erro "t.map is not a function"

// Função para verificar a conexão com o Redis
export async function checkRedisConnection(): Promise<boolean> {
  try {
    // Verificar se o cliente Redis foi inicializado
    if (!redis) {
      console.error("Cliente Redis não foi inicializado")
      return false
    }

    // Verificar se as variáveis de ambiente estão definidas
    if (!redisUrl) {
      console.error("URL do Redis não está definida")
      return false
    }

    if (!redisToken) {
      console.error("Token do Redis não está definido")
      return false
    }

    // Tentar executar um comando simples
    try {
      // Usar set/get em vez de ping para verificar a conexão
      const testKey = `test-connection-${Date.now()}`
      await redis.set(testKey, "test-value")
      const value = await redis.get(testKey)

      // Limpar a chave de teste
      await redis.del(testKey)

      return value === "test-value"
    } catch (pingError) {
      console.error("Erro ao testar conexão com Redis:", pingError)
      return false
    }
  } catch (error) {
    console.error("Falha na conexão com o Redis:", error)
    return false
  }
}

// Função auxiliar para obter o cliente Redis
export function getRedisClient(): Redis | null {
  return redis
}

// Prefixos para as chaves no Redis
const EBOOK_PREFIX = "ebook:"
const EBOOK_PAGE_PREFIX = "ebook-page:"
const EBOOK_QUEUE_PREFIX = "ebook-queue:"

// Tipos para o estado do ebook
export type EbookQueueState = {
  id: string
  title: string
  description: string
  contentMode: string
  status: "queued" | "processing" | "completed" | "failed" | "partial"
  totalPages: number
  completedPages: number
  processingPages: number
  queuedPages: number
  failedPages: number
  createdAt: number
  updatedAt: number
}

// Tipos para uma página na fila
export type EbookQueuePage = {
  ebookId: string
  pageIndex: number
  pageTitle: string
  status: "queued" | "processing" | "completed" | "failed"
  content: string
  error?: string
  attempts: number
  createdAt: number
  updatedAt: number
}

// Verificar se a função createEbookQueue está corretamente implementada
// Se não estiver, adicionar ou atualizar a implementação

// Certifique-se de que a função createEbookQueue está exportada corretamente
export async function createEbookQueue(
  title: string,
  description: string,
  contentMode: string,
  pageTitles: string[],
): Promise<{ ebookId: string; state: EbookQueueState }> {
  try {
    // Verificar a conexão com o Redis
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      throw new Error("Não foi possível conectar ao Redis. Verifique suas variáveis de ambiente.")
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      throw new Error("Cliente Redis não está disponível")
    }

    // Gerar ID único para o ebook
    const ebookId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    // Criar o estado inicial do ebook
    const ebookState: EbookQueueState = {
      id: ebookId,
      title,
      description,
      contentMode,
      status: "queued",
      totalPages: pageTitles.length,
      completedPages: 0,
      processingPages: 0,
      queuedPages: pageTitles.length,
      failedPages: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Salvar o estado do ebook no Redis
    await client.set(`${EBOOK_PREFIX}${ebookId}`, JSON.stringify(ebookState))

    // Adicionar cada página à fila
    const queuePromises = pageTitles.map((pageTitle, index) => {
      const page: EbookQueuePage = {
        ebookId,
        pageIndex: index,
        pageTitle,
        status: "queued",
        content: "",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      // Salvar a página no Redis
      return client.set(`${EBOOK_PAGE_PREFIX}${ebookId}:${index}`, JSON.stringify(page)).then(() => {
        // Adicionar à fila de processamento
        return client.lpush(
          `${EBOOK_QUEUE_PREFIX}pages`,
          JSON.stringify({
            ebookId,
            pageIndex: index,
          }),
        )
      })
    })

    // Aguardar todas as operações
    await Promise.all(queuePromises)

    return { ebookId, state: ebookState }
  } catch (error) {
    console.error("Erro ao criar fila do ebook:", error)
    throw new Error(`Falha ao criar fila do ebook: ${error instanceof Error ? error.message : "Erro desconhecido"}`)
  }
}

// Modificar a função getEbookState para lidar melhor com diferentes tipos de resposta

// Função para obter o estado de um ebook
export async function getEbookState(ebookId: string): Promise<EbookQueueState | null> {
  try {
    // Verificar a conexão com o Redis
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      console.warn("Não foi possível conectar ao Redis. Retornando null.")
      return null
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Retornando null.")
      return null
    }

    // Obter o estado do ebook do Redis
    const ebookState = await client.get(`${EBOOK_PREFIX}${ebookId}`)

    if (!ebookState) {
      return null
    }

    // Verificar se ebookState já é um objeto (não precisa de parse)
    if (typeof ebookState === "object" && ebookState !== null && !Array.isArray(ebookState)) {
      return ebookState as EbookQueueState
    }

    // Se for uma string, fazer o parse
    try {
      return JSON.parse(ebookState as string) as EbookQueueState
    } catch (parseError) {
      console.error("Erro ao fazer parse do estado do ebook:", parseError)
      console.error("Conteúdo recebido:", ebookState)
      throw new Error(
        `Erro ao analisar o estado do ebook: ${parseError instanceof Error ? parseError.message : "Erro desconhecido"}`,
      )
    }
  } catch (error) {
    console.error("Erro ao obter estado do ebook:", error)
    return null
  }
}

// Função para obter as páginas de um ebook
export async function getEbookPages(ebookId: string): Promise<EbookQueuePage[]> {
  try {
    // Verificar a conexão com o Redis
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      console.warn("Não foi possível conectar ao Redis. Retornando array vazio.")
      return []
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Retornando array vazio.")
      return []
    }

    try {
      // Em vez de usar keys, vamos tentar obter cada página diretamente
      // Assumindo que sabemos que um ebook tem no máximo 30 páginas
      const pages: EbookQueuePage[] = []

      for (let i = 0; i < 30; i++) {
        try {
          const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${i}`
          const pageData = await client.get(pageKey)

          if (pageData) {
            // Converter pageData para objeto
            if (typeof pageData === "object" && pageData !== null && !Array.isArray(pageData)) {
              pages.push(pageData as EbookQueuePage)
            } else if (typeof pageData === "string") {
              try {
                pages.push(JSON.parse(pageData) as EbookQueuePage)
              } catch (parseError) {
                console.error(`Erro ao fazer parse da página ${i}:`, parseError)
              }
            }
          }
        } catch (pageError) {
          console.error(`Erro ao obter página ${i}:`, pageError)
          // Continuar para a próxima página
        }
      }

      return pages
    } catch (error) {
      console.error("Erro ao obter páginas do ebook:", error)
      return []
    }
  } catch (error) {
    console.error("Erro ao obter páginas do ebook:", error)
    return []
  }
}

// Função para obter o próximo item da fila
export async function getNextQueueItem(): Promise<{ ebookId: string; pageIndex: number } | null> {
  try {
    // Verificar a conexão com o Redis
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      console.warn("Não foi possível conectar ao Redis. Retornando null.")
      return null
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Retornando null.")
      return null
    }

    // Obter o próximo item da fila
    const item = await client.lpop(`${EBOOK_QUEUE_PREFIX}pages`)

    if (!item) {
      return null
    }

    // Verificar se já é um objeto
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      // Verificar se o objeto tem as propriedades necessárias
      if ("ebookId" in item && "pageIndex" in item) {
        return item as { ebookId: string; pageIndex: number }
      } else {
        console.error("Objeto retornado pelo Redis não tem as propriedades esperadas:", item)
        return null
      }
    }

    // Se for string, fazer o parse
    try {
      const parsedItem = JSON.parse(item as string) as { ebookId: string; pageIndex: number }

      // Verificar se o objeto tem as propriedades necessárias
      if (!parsedItem.ebookId || typeof parsedItem.pageIndex !== "number") {
        console.error("Item da fila não tem as propriedades esperadas após parse:", parsedItem)
        return null
      }

      return parsedItem
    } catch (parseError) {
      console.error("Erro ao fazer parse do item da fila:", parseError)
      console.error("Conteúdo recebido:", item)
      return null
    }
  } catch (error) {
    console.error("Erro ao obter próximo item da fila:", error)
    return null
  }
}

// Função para atualizar o status de uma página
export async function updatePageStatus(
  ebookId: string,
  pageIndex: number,
  status: "queued" | "processing" | "completed" | "failed",
  content = "",
  error = "",
): Promise<void> {
  try {
    // Verificar a conexão com o Redis
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      console.warn("Não foi possível conectar ao Redis. Abortando atualização.")
      return
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Abortando atualização.")
      return
    }

    // Obter a página atual
    const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${pageIndex}`
    const pageData = await client.get(pageKey)

    if (!pageData) {
      console.warn(`Página ${pageIndex} para o ebook ${ebookId} não encontrada.`)
      return
    }

    // Converter pageData para objeto
    let page: EbookQueuePage
    if (typeof pageData === "object" && pageData !== null) {
      page = pageData as EbookQueuePage
    } else if (typeof pageData === "string") {
      try {
        page = JSON.parse(pageData) as EbookQueuePage
      } catch (parseError) {
        console.error("Erro ao fazer parse dos dados da página:", parseError)
        console.error("Conteúdo recebido:", pageData)

        // Criar um objeto de página padrão para evitar falhas
        page = {
          ebookId,
          pageIndex,
          pageTitle: `Página ${pageIndex + 1}`,
          status: "queued",
          content: "",
          attempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      }
    } else {
      console.error(`Tipo de dados inesperado retornado pelo Redis: ${typeof pageData}`)
      return
    }

    // Atualizar os dados da página
    page.status = status
    page.content = content
    page.error = error
    page.updatedAt = Date.now()
    page.attempts += 1

    // Salvar a página atualizada no Redis
    await client.set(pageKey, JSON.stringify(page))

    // Atualizar o estado do ebook
    await updateEbookState(ebookId)
  } catch (error) {
    console.error("Erro ao atualizar status da página:", error)
  }
}

// Função auxiliar para atualizar o estado do ebook
async function updateEbookState(ebookId: string): Promise<void> {
  try {
    // Obter o estado atual do ebook
    const ebookState = await getEbookState(ebookId)

    if (!ebookState) {
      console.warn(`Ebook ${ebookId} não encontrado.`)
      return
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Abortando atualização.")
      return
    }

    // Obter todas as páginas do ebook
    const pages = await getEbookPages(ebookId)

    // Verificar se pages é um array
    if (!Array.isArray(pages)) {
      console.error("Erro: pages não é um array:", pages)
      return
    }

    // Calcular o novo estado do ebook
    const completedPages = pages.filter((page) => page.status === "completed").length
    const processingPages = pages.filter((page) => page.status === "processing").length
    const queuedPages = pages.filter((page) => page.status === "queued").length
    const failedPages = pages.filter((page) => page.status === "failed").length

    let ebookStatus: EbookQueueState["status"] = "processing"

    if (failedPages === ebookState.totalPages) {
      ebookStatus = "failed"
    } else if (completedPages === ebookState.totalPages) {
      ebookStatus = "completed"
    } else if (queuedPages === ebookState.totalPages) {
      ebookStatus = "queued"
    } else if (completedPages + failedPages === ebookState.totalPages) {
      ebookStatus = "partial"
    } else {
      ebookStatus = "processing"
    }

    // Atualizar o estado do ebook
    ebookState.status = ebookStatus
    ebookState.completedPages = completedPages
    ebookState.processingPages = processingPages
    ebookState.queuedPages = queuedPages
    ebookState.failedPages = failedPages
    ebookState.updatedAt = Date.now()

    // Salvar o estado atualizado do ebook no Redis
    await client.set(`${EBOOK_PREFIX}${ebookId}`, JSON.stringify(ebookState))
  } catch (error) {
    console.error("Erro ao atualizar estado do ebook:", error)
  }
}

// Função para obter os detalhes de uma página específica
export async function getEbookPage(
  ebookId: string,
  pageIndex: number,
): Promise<EbookQueuePage | null> {
  try {
    // Verificar a conexão com o Redis
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      console.warn("Não foi possível conectar ao Redis. Retornando null.")
      return null
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Retornando null.")
      return null
    }

    // Obter os dados da página do Redis
    const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${pageIndex}`
    const pageData = await client.get(pageKey)

    if (!pageData) {
      return null
    }

    // Verificar se pageData já é um objeto (não precisa de parse)
    if (typeof pageData === "object" && pageData !== null && !Array.isArray(pageData)) {
      // Verificar se tem as propriedades mínimas esperadas
      if ('ebookId' in pageData && 'pageIndex' in pageData && 'pageTitle' in pageData) {
        return pageData as EbookQueuePage
      } else {
         console.error("Objeto da página retornado pelo Redis não tem as propriedades esperadas:", pageData)
         return null
      }
    }

    // Se for uma string, fazer o parse
    try {
      const parsedPage = JSON.parse(pageData as string) as EbookQueuePage
       // Verificar se tem as propriedades mínimas esperadas após parse
      if (!parsedPage.ebookId || typeof parsedPage.pageIndex !== 'number' || !parsedPage.pageTitle) {
        console.error("Dados da página não têm as propriedades esperadas após parse:", parsedPage)
        return null
      }
      return parsedPage
    } catch (parseError) {
      console.error(`Erro ao fazer parse dos dados da página ${pageIndex}:`, parseError)
      console.error("Conteúdo recebido:", pageData)
      return null
    }
  } catch (error) {
    console.error(`Erro ao obter página ${pageIndex} do ebook ${ebookId}:`, error)
    return null
  }
}
