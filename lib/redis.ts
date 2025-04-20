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
  newStatus: "queued" | "processing" | "completed" | "failed",
  content = "",
  error = "",
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    console.error("[updatePageStatus] Redis client not available.");
    return; // Não podemos fazer nada sem o cliente
  }

  const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${pageIndex}`;
  const stateKey = `${EBOOK_STATE_PREFIX}${ebookId}`;

  try {
    // 1. Obter os dados atuais da página
    const currentPageDataString = await client.get<string>(pageKey); // Ler como string

    if (!currentPageDataString) {
      console.error(`[updatePageStatus] Page data not found for key: ${pageKey}`);
      // Opcional: Tentar atualizar o estado geral mesmo assim? Ou lançar erro?
      // Por enquanto, vamos logar e continuar para tentar atualizar o estado geral.
      // return; // Se quisermos parar se a página não existe
    }

    let currentPageData: EbookQueuePage | null = null;
    let previousStatus: EbookQueuePage['status'] | null = null;
    if (currentPageDataString) {
        try {
            currentPageData = JSON.parse(currentPageDataString) as EbookQueuePage;
            previousStatus = currentPageData.status; // Guardar status anterior
        } catch (parseError) {
            console.error(`[updatePageStatus] Failed to parse JSON for page ${pageKey}. Data: '${currentPageDataString}'`, parseError);
            // Não podemos atualizar a página se não pudermos parseá-la.
            // Vamos apenas tentar atualizar o estado geral.
            currentPageData = null;
        }
    }


    // 2. Atualizar os dados da página (se possível)
    let updatedPageData: EbookQueuePage | null = null;
    if (currentPageData) {
        updatedPageData = {
            ...currentPageData,
            status: newStatus,
            content: newStatus === "completed" ? content : currentPageData.content, // Apenas salva conteúdo no 'completed'
            error: newStatus === "failed" ? error : "", // Apenas salva erro no 'failed'
            attempts: newStatus === "failed" ? (currentPageData.attempts || 0) + 1 : currentPageData.attempts, // Incrementa tentativas na falha
            updatedAt: Date.now(),
        };
        // Remover o campo 'error' se não estiver em 'failed' para limpar erros antigos
        if (newStatus !== "failed") {
           delete updatedPageData.error;
        }

        // Salvar a página atualizada
        try {
            await client.set(pageKey, JSON.stringify(updatedPageData));
            console.log(`[updatePageStatus] Updated page ${pageIndex} status to ${newStatus} for ebook ${ebookId}`);
        } catch (setPageError) {
             console.error(`[updatePageStatus] Failed to SET updated page data for ${pageKey}`, setPageError);
             // A atualização do estado geral ainda será tentada abaixo
        }

    } else {
        console.warn(`[updatePageStatus] Cannot update page ${pageKey} as current data could not be retrieved or parsed.`);
    }


    // 3. Atualizar o estado geral do ebook no HASH (sempre tentar, mesmo se a página falhou)
    const now = Date.now();
    const multi = client.multi(); // Usar MULTI para atomicidade nas atualizações de contadores

    // Atualizar timestamp 'updatedAt' do estado geral
    multi.hset(stateKey, { updatedAt: now });

    // Ajustar contadores baseado na mudança de status (se o status anterior era conhecido)
    if (previousStatus && previousStatus !== newStatus && currentPageData) { // Apenas ajustar se o status mudou E a página existia
      console.log(`[updatePageStatus] Adjusting counters for status change: ${previousStatus} -> ${newStatus}`);
      // Decrementar contador do status anterior
      if (previousStatus === "queued") multi.hincrby(stateKey, "queuedPages", -1);
      if (previousStatus === "processing") multi.hincrby(stateKey, "processingPages", -1);
      if (previousStatus === "completed") multi.hincrby(stateKey, "completedPages", -1);
      if (previousStatus === "failed") multi.hincrby(stateKey, "failedPages", -1);

      // Incrementar contador do novo status
      if (newStatus === "queued") multi.hincrby(stateKey, "queuedPages", 1);
      if (newStatus === "processing") multi.hincrby(stateKey, "processingPages", 1);
      if (newStatus === "completed") multi.hincrby(stateKey, "completedPages", 1);
      if (newStatus === "failed") multi.hincrby(stateKey, "failedPages", 1);
    } else if (!previousStatus && currentPageData) {
        // Se a página foi encontrada mas o status anterior não (talvez estado inicial), incrementar o novo status
        console.log(`[updatePageStatus] Incrementing counter for initial status: ${newStatus}`);
        if (newStatus === "queued") multi.hincrby(stateKey, "queuedPages", 1);
        if (newStatus === "processing") multi.hincrby(stateKey, "processingPages", 1);
        if (newStatus === "completed") multi.hincrby(stateKey, "completedPages", 1);
        if (newStatus === "failed") multi.hincrby(stateKey, "failedPages", 1);
    } else {
         console.warn(`[updatePageStatus] Cannot adjust counters accurately for ${pageKey}. Previous status: ${previousStatus}, Current data exists: ${!!currentPageData}`);
    }


    // Atualizar o status GERAL do ebook para 'processing' se alguma página entrar nesse estado
    // e o status geral ainda for 'queued'
    // (Podemos precisar de lógica mais complexa para 'partial', 'completed', 'failed' aqui ou na GET)
    if (newStatus === 'processing') {
         multi.hsetnx(stateKey, "status", "processing"); // Define 'processing' apenas se 'status' não existir ou for 'queued'
         console.log(`[updatePageStatus] Attempted HSETNX for overall status to processing for ${ebookId}`);
    }

    // Executar a transação
    try {
        const txResult = await multi.exec();
        console.log(`[updatePageStatus] Transaction result for state update of ${ebookId}:`, txResult);
        if (txResult === null || txResult.some(res => res === null)) { // Verificar se algum comando na transação falhou
            console.error(`[updatePageStatus] Redis transaction failed for state update of ${ebookId}. Results:`, txResult);
        }
    } catch (txError) {
         console.error(`[updatePageStatus] Error executing Redis transaction for state update of ${ebookId}:`, txError);
    }


  } catch (error) {
    console.error(
      `[updatePageStatus] Unexpected error updating status for page ${pageIndex} of ebook ${ebookId} to ${newStatus}:`,
      error,
    );
    // Não relançar o erro aqui para não parar o worker necessariamente,
    // mas a falha já foi logada.
  }
}


// Função para obter os dados de uma página específica (MODIFICADA para parse seguro)
export async function getEbookPage(
  ebookId: string,
  pageIndex: number,
): Promise<EbookQueuePage | null> {
  const client = getRedisClient();
  if (!client) {
    console.error("[getEbookPage] Redis client not available.");
    return null;
  }
  const pageKey = `${EBOOK_PAGE_PREFIX}${ebookId}:${pageIndex}`;

  try {
    const pageDataString = await client.get<string>(pageKey); // Sempre ler como string

    if (!pageDataString) {
      console.log(`[getEbookPage] No data found for key: ${pageKey}`);
      return null;
    }

    // Tentar fazer o parse seguro
    try {
      const pageData = JSON.parse(pageDataString) as EbookQueuePage;
      // Opcional: Validar se o objeto parseado tem os campos esperados
      if (typeof pageData === 'object' && pageData !== null && typeof pageData.ebookId === 'string') {
          return pageData;
      } else {
          console.error(`[getEbookPage] Parsed data for ${pageKey} is not a valid EbookQueuePage object.`);
          return null;
      }
    } catch (parseError) {
      console.error(`[getEbookPage] Failed to parse JSON for key ${pageKey}. Data: '${pageDataString}'`, parseError);
      return null;
    }
  } catch (error) {
    console.error(`[getEbookPage] Error fetching page data for key ${pageKey}:`, error);
    return null;
  }
}

// Função para atualizar o status geral do ebook (MODIFICADA para HASH)
export async function updateEbookOverallStatus(
  ebookId: string,
  newStatus: EbookQueueState['status']
): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (!client) {
      console.warn("[updateEbookOverallStatus] Redis client not available.");
      return false;
    }
    const stateKey = `${EBOOK_STATE_PREFIX}${ebookId}`;

    // Verifica se o hash existe antes de tentar atualizar
    const exists = await client.exists(stateKey);
    if (!exists) {
      console.warn(`[updateEbookOverallStatus] Ebook state key ${stateKey} does not exist. Cannot update status.`);
      return false;
    }

    // Atualiza apenas o campo 'status' e 'updatedAt' no hash
    const result = await client.hmset(stateKey, {
      status: newStatus,
      updatedAt: String(Date.now()) // Atualiza também o timestamp
    });

    // hmset retorna 'OK' em sucesso no Upstash Redis v1/v2
    // Verificar se a resposta foi 'OK' pode ser mais robusto
    if (result === "OK") {
        console.log(`[updateEbookOverallStatus] Status geral do ebook ${ebookId} atualizado para ${newStatus}`);
        return true;
    } else {
        console.warn(`[updateEbookOverallStatus] Falha ao atualizar status para ${newStatus} para o ebook ${ebookId}. Resultado:`, result);
        return false;
    }

  } catch (error) {
    console.error(`[updateEbookOverallStatus] Erro ao atualizar status geral do ebook ${ebookId} para ${newStatus}:`, error);
    return false;
  }
}
