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
    // Incluir mensagem do erro original
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Falha ao criar fila do ebook: ${errorMessage}`)
  }
}

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

    // Obter o estado do ebook do Redis. A biblioteca pode retornar string ou objeto.
    const ebookStateData = await client.get(`${EBOOK_PREFIX}${ebookId}`);

    if (!ebookStateData) {
      console.log(`[getEbookState] Dados não encontrados para ${ebookId}`);
      return null;
    }

    // Log Diagnóstico 1: Tipo de dado recebido
    console.log(`[getEbookState] Tipo de dado recebido para ${ebookId}: ${typeof ebookStateData}`);
    console.log(`[getEbookState] Valor recebido (preview): ${JSON.stringify(ebookStateData)?.substring(0, 100)}...`);

    // Verificar se já é um objeto
    if (typeof ebookStateData === "object" && ebookStateData !== null) {
        // Log Diagnóstico 2: Entrou no bloco 'object'
        console.log(`[getEbookState] Tratando ${ebookId} como objeto pré-parseado.`);
        // Validar minimamente se parece um EbookQueueState
        if ('id' in ebookStateData && 'title' in ebookStateData && 'totalPages' in ebookStateData) {
            return ebookStateData as EbookQueueState; 
        } else {
            console.error("Objeto retornado pelo Redis para ebook state é inválido (bloco object):", ebookStateData);
            return null;
        }
    }
    
    // Se for uma string, tentar fazer o parse
    if (typeof ebookStateData === "string") {
        // Log Diagnóstico 3: Vai tentar fazer parse
        console.log(`[getEbookState] Tentando JSON.parse para ${ebookId}.`);
        try {
            const parsedState = JSON.parse(ebookStateData) as EbookQueueState;
             // Validar minimamente após parse
            if (parsedState && parsedState.id && parsedState.title && typeof parsedState.totalPages === 'number') {
                return parsedState;
            } else {
                console.error("Estado do ebook após parse é inválido (bloco string):", parsedState);
                return null;
            }
        } catch (parseError) {
            console.error("Erro no JSON.parse do estado do ebook string:", parseError);
            console.error("Conteúdo recebido (string):", ebookStateData);
            return null; 
        }
    }

    // Se não for nem objeto nem string (inesperado)
    console.error(`[getEbookState] Tipo inesperado (${typeof ebookStateData}) recebido para ${ebookId}.`);
    return null;

  } catch (error) {
    console.error("Erro ao obter estado do ebook:", error);
    return null;
  }
}

// Função para obter as páginas de um ebook (otimizada com MGET)
export async function getEbookPages(ebookId: string): Promise<EbookQueuePage[]> {
  try {
    const isConnected = await checkRedisConnection()
    if (!isConnected) {
      console.warn("Não foi possível conectar ao Redis. Retornando array vazio.")
      return []
    }

    const client = getRedisClient()
    if (!client) {
      console.warn("Cliente Redis não está disponível. Retornando array vazio.")
      return []
    }

    // Primeiro, obter o estado do ebook para saber o total de páginas
    const ebookState = await getEbookState(ebookId);
    if (!ebookState) {
        console.warn(`Estado do ebook ${ebookId} não encontrado ao buscar páginas. Retornando array vazio.`);
        return [];
    }
    const totalPages = ebookState.totalPages;

    if (totalPages <= 0) {
        return []; // Nenhuma página para buscar
    }

    // Criar a lista de todas as chaves de página
    const pageKeys = Array.from({ length: totalPages }, (_, i) => `${EBOOK_PAGE_PREFIX}${ebookId}:${i}`);

    // Usar MGET para buscar todas as chaves de uma vez
    const results = await client.mget<string[]>(...pageKeys); // Esperar sempre array de strings (ou null)

    const pages: EbookQueuePage[] = [];
    results.forEach((pageData, index) => {
      // pageData será string ou null
      if (!pageData) {
         // Ignorar resultados nulos (chave não existe)
         return;
      }

      try {
        // Fazer o parse da string JSON
        const parsedPage = JSON.parse(pageData) as EbookQueuePage;

        // Validar o objeto parseado
        if (parsedPage && parsedPage.ebookId && typeof parsedPage.pageIndex === 'number' && parsedPage.pageTitle) {
            pages.push(parsedPage);
        } else {
            console.warn(`Dados da página ${index} inválidos após parse:`, parsedPage);
        }

      } catch (parseError) {
        console.error(`Erro ao fazer parse da página ${index} (chave ${pageKeys[index]}):`, parseError, "Data String:", pageData);
      }
    });

    // Ordenar pelo índice para garantir a ordem correta
    pages.sort((a, b) => a.pageIndex - b.pageIndex);

    return pages;

  } catch (error) {
    console.error(`Erro ao obter páginas do ebook ${ebookId} com mget:`, error);
    return []; // Retornar array vazio em caso de erro
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
    const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${pageIndex}`;
    const pageData = await client.get(pageKey); // Pode retornar string ou objeto

    if (!pageData) {
      console.warn(`Página ${pageIndex} para o ebook ${ebookId} não encontrada.`)
      return;
    }

    // Converter/validar pageData para objeto
    let page: EbookQueuePage | null = null;

    if (typeof pageData === "object" && pageData !== null) {
        // Validar minimamente
         if ('ebookId' in pageData && 'pageIndex' in pageData && 'pageTitle' in pageData) {
            page = pageData as EbookQueuePage;
         } else {
            console.error("Objeto retornado pelo Redis para page data em updatePageStatus é inválido:", pageData);
         }
    } else if (typeof pageData === "string") {
      try {
        const parsedPage = JSON.parse(pageData) as EbookQueuePage;
         // Validar minimamente após parse
         if (parsedPage && parsedPage.ebookId && typeof parsedPage.pageIndex === 'number' && parsedPage.pageTitle) {
             page = parsedPage;
         } else {
             console.error("Dados da página inválidos após parse em updatePageStatus:", parsedPage);
         }
      } catch (parseError) {
        console.error("Erro ao fazer parse dos dados da página (string) em updatePageStatus:", parseError)
        console.error("Conteúdo recebido string:", pageData)
      }
    } else {
       console.error(`Tipo inesperado recebido para page data em updatePageStatus: ${typeof pageData}`);
    }

    // Se não conseguimos obter um objeto de página válido, não podemos continuar
    if (!page) {
        console.error(`Não foi possível obter dados válidos para a página ${pageIndex} do ebook ${ebookId}. Abortando atualização.`);
        return;
    }

    // Atualizar os dados da página (agora 'page' é um objeto EbookQueuePage válido)
    page.status = status;
    page.content = content;
    page.error = error;
    page.updatedAt = Date.now();
    // Não incrementar attempts aqui intencionalmente

    // Salvar a página atualizada no Redis
    await client.set(pageKey, JSON.stringify(page));

    // Atualizar o estado do ebook
    await updateEbookState(ebookId);
  } catch (error) {
    console.error("Erro ao atualizar status da página:", error);
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
    let completedCount = 0;
    let processingCount = 0;
    let queuedCount = 0;
    let failedCount = 0;
    const now = Date.now();
    const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

    pages.forEach((page) => {
      if (page.status === "completed") {
        completedCount++;
      } else if (page.status === "processing") {
        // Verificar timeout de processamento
        if (now - page.updatedAt > PROCESSING_TIMEOUT_MS) {
          console.warn(`Página ${page.pageIndex} do ebook ${ebookId} excedeu timeout de processamento. Marcando como falha.`);
          // Idealmente, deveríamos chamar updatePageStatus aqui, mas isso criaria um loop.
          // Por agora, apenas contamos como falha para o estado geral.
          failedCount++;
        } else {
          processingCount++;
        }
      } else if (page.status === "queued") {
        queuedCount++;
      } else if (page.status === "failed") {
        failedCount++;
      }
    });

    let ebookStatus: EbookQueueState["status"] = "processing";

    if (failedCount + completedCount === ebookState.totalPages) { // Inclui falhas por timeout
      ebookStatus = failedCount > 0 ? "partial" : "completed"; // Se tem falhas, é parcial
      if (failedCount === ebookState.totalPages) ebookStatus = "failed";
    } else if (queuedCount === ebookState.totalPages) {
      ebookStatus = "queued";
    } else if (processingCount > 0 || queuedCount > 0) {
       ebookStatus = "processing"; // Ainda processando ou esperando
    } else {
      // Caso inesperado, talvez todas completas mas cálculo acima falhou?
      console.warn("Estado inesperado ao calcular status do ebook", {completedCount, processingCount, queuedCount, failedCount, totalPages: ebookState.totalPages});
      ebookStatus = "partial"; // Default seguro
    }

    // Atualizar o estado do ebook
    ebookState.status = ebookStatus;
    ebookState.completedPages = completedCount;
    ebookState.processingPages = processingCount;
    ebookState.queuedPages = queuedCount;
    ebookState.failedPages = failedCount; // Contagem agora inclui timeouts
    ebookState.updatedAt = now;

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
    const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${pageIndex}`; 
    const pageData = await client.get(pageKey); // Pode retornar string ou objeto

    if (!pageData) {
      return null;
    }

    // Verificar se já é um objeto
    if (typeof pageData === "object" && pageData !== null) {
        // Validar minimamente
        if ('ebookId' in pageData && 'pageIndex' in pageData && 'pageTitle' in pageData) {
            return pageData as EbookQueuePage;
        } else {
            console.error("Objeto retornado pelo Redis para page data é inválido:", pageData);
            return null;
        }
    }

    // Se for string, tentar fazer o parse
    if (typeof pageData === "string") {
        try {
            const parsedPage = JSON.parse(pageData) as EbookQueuePage;
            // Validar minimamente após parse
            if (parsedPage && parsedPage.ebookId && typeof parsedPage.pageIndex === 'number' && parsedPage.pageTitle) {
                return parsedPage;
            } else {
                console.error("Dados da página inválidos após parse em getEbookPage:", parsedPage);
                return null;
            }
        } catch (parseError) {
            console.error(`Erro ao fazer parse dos dados da página ${pageIndex} (string) em getEbookPage:`, parseError);
            console.error("Conteúdo recebido string:", pageData);
            return null;
        }
    }

     // Se não for nem objeto nem string (inesperado)
    console.error(`Tipo inesperado recebido para page data: ${typeof pageData}`);
    return null;

  } catch (error) {
    console.error(`Erro ao obter página ${pageIndex} do ebook ${ebookId}:`, error);
    return null;
  }
}
