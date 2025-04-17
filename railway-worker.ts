import Redis from 'ioredis';
import { getEbookState, getEbookPages, updatePageStatus } from '@/lib/redis'; // Assumindo que estas funções existem e são exportadas de lib/redis
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Definir tipo para o item da fila
type QueueItem = {
  ebookId: string;
  pageIndex: number;
};

// Atenção: Este script é para ser executado fora do ambiente Next.js/Vercel.
// Certifique-se de que as variáveis de ambiente (OPENAI_API_KEY, KV_URL)
// estejam disponíveis no ambiente onde este worker será executado (ex: Railway).
// KV_URL é a string de conexão padrão do Redis (rediss://...)

// Configurações de conteúdo (copiado de app/api/worker/route.ts)
const CONTENT_MODES = {
  FULL: {
    maxTokens: 600,
    promptSuffix: "Escreva um conteúdo detalhado com aproximadamente 400-500 palavras.",
  },
  MEDIUM: {
    maxTokens: 450,
    promptSuffix: "Escreva um conteúdo conciso com aproximadamente 250-300 palavras.",
  },
  MINIMAL: {
    maxTokens: 300,
    promptSuffix: "Escreva um conteúdo breve com aproximadamente 150-200 palavras.",
  },
  ULTRA_MINIMAL: {
    maxTokens: 150,
    promptSuffix: "Escreva apenas um parágrafo curto com aproximadamente 50-100 palavras.",
  },
};

// Função para gerar o conteúdo de uma página (copiado de app/api/worker/route.ts)
async function generatePageContent(
  ebookTitle: string,
  ebookDescription: string,
  pageTitle: string,
  pageIndex: number,
  contentMode: string,
  allPageTitles: string[]
): Promise<string> {
  try {
    const mode = CONTENT_MODES[contentMode as keyof typeof CONTENT_MODES] || CONTENT_MODES.MEDIUM;

    const tableOfContents = allPageTitles
      .map((title, index) => `${index + 1}. ${title}${index === pageIndex ? " <-- VOCÊ ESTÁ AQUI" : ""}`)
      .join("\n");

    const prompt = `Você é um escritor especialista criando o conteúdo para um ebook.
    Título do Ebook: "${ebookTitle}"
    Descrição: "${ebookDescription}"

    Sumário Completo:
    ${tableOfContents}

    Sua tarefa é escrever o conteúdo APENAS para a Página ${pageIndex + 1}, cujo título é "${pageTitle}".

    Instruções importantes:
    1. Considere o contexto geral do ebook fornecido pelo sumário.
    2. Foque estritamente no tópico definido pelo título desta página ("${pageTitle}").
    3. Evite repetir informações que provavelmente foram abordadas em páginas anteriores ou serão abordadas em páginas futuras, use o sumário como guia.
    4. ${mode.promptSuffix}
    5. Escreva em português do Brasil com linguagem clara e envolvente.
    6. NÃO inclua o título da página ou o número da página no conteúdo que você escrever. Apenas o texto da página.
    7. NÃO escreva introduções ou conclusões genéricas para esta página; vá direto ao ponto do título.
    
    Conteúdo da Página ${pageIndex + 1}:`;

    console.log(`[Worker] Gerando conteúdo para página ${pageIndex + 1} (Ebook: ${ebookTitle.substring(0, 20)}...)`);
    const { text } = await generateText({
      model: openai("gpt-4o"), // Certifique-se que OPENAI_API_KEY está no env
      prompt,
      maxTokens: mode.maxTokens + 50,
    });

    return text;
  } catch (error) {
    console.error(`[Worker] Error generating page content for page ${pageIndex}:`, error);
    throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Função para processar um item da fila (copiado de app/api/worker/route.ts e adaptado para log)
async function processQueueItem(item: QueueItem): Promise<boolean> {
  const { ebookId, pageIndex } = item;
  console.log(`[Worker] Processing job: EbookID=${ebookId}, PageIndex=${pageIndex}`);

  try {
     // Verificar se as funções do Redis estão disponíveis
     if (typeof getEbookState !== 'function' || typeof getEbookPages !== 'function' || typeof updatePageStatus !== 'function') {
        throw new Error("Redis utility functions (getEbookState, getEbookPages, updatePageStatus) are not available. Check imports.");
     }

    const [ebookState, allPages] = await Promise.all([
        getEbookState(ebookId),
        getEbookPages(ebookId)
    ]);

    if (!ebookState) {
      console.error(`[Worker] Ebook ${ebookId} not found for page ${pageIndex}`);
      // Não podemos atualizar status se o ebook não existe
      return false;
    }
    if (!Array.isArray(allPages) || allPages.length === 0) {
       console.error(`[Worker] Page data not found or invalid for ebook ${ebookId}`);
       await updatePageStatus(ebookId, pageIndex, "failed", "", "Page data not found or invalid in Redis");
       return false;
    }

    const currentPageData = allPages.find(p => p.pageIndex === pageIndex);
    if (!currentPageData) {
      console.error(`[Worker] Current page data (${pageIndex}) not found in list for ebook ${ebookId}`);
       await updatePageStatus(ebookId, pageIndex, "failed", "", "Current page data not found in list");
       return false;
    }

    const allPageTitles = allPages
                           .sort((a, b) => a.pageIndex - b.pageIndex)
                           .map(p => p.pageTitle);

    await updatePageStatus(ebookId, pageIndex, "processing");
    console.log(`[Worker] Status updated to processing for ${ebookId}-${pageIndex}`);

    const content = await generatePageContent(
      ebookState.title,
      ebookState.description,
      currentPageData.pageTitle,
      pageIndex,
      ebookState.contentMode,
      allPageTitles
    );

    await updatePageStatus(ebookId, pageIndex, "completed", content);
    console.log(`[Worker] Status updated to completed for ${ebookId}-${pageIndex}`);

    return true;
  } catch (error) {
    console.error(`[Worker] Error processing queue item ${ebookId}-${pageIndex}:`, error);
    try {
      // Tentamos atualizar o status para falha mesmo em caso de erro
      await updatePageStatus(ebookId, pageIndex, "failed", "", error instanceof Error ? error.message : "Unknown error");
       console.log(`[Worker] Status updated to failed for ${ebookId}-${pageIndex}`);
    } catch (updateError) {
      console.error("[Worker] CRITICAL: Error updating page status to failed after processing error:", updateError);
    }
    return false;
  }
}

// --- Configurar Conexão Redis com ioredis ---
// Usará a variável de ambiente KV_URL configurada na Railway
if (!process.env.KV_URL) {
    console.error("Missing environment variable: KV_URL is required for ioredis connection.");
    process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
    console.warn("Missing environment variable: OPENAI_API_KEY is required for generating content.");
    // Poderia sair com process.exit(1) aqui também se for crítico
}

const redis = new Redis(process.env.KV_URL, {
    // Opções adicionais de ioredis podem ser necessárias para Vercel KV/Upstash,
    // especialmente se TLS for obrigatório (geralmente é com rediss://)
    // A opção padrão `enableTLSForSentinelMode` pode ser suficiente, mas verificar.
    // Adicionar maxRetriesPerRequest: null para tentar reconectar indefinidamente.
    maxRetriesPerRequest: null,
    enableReadyCheck: false // Pode ser útil com alguns provedores de Redis
});

redis.on('error', (err) => {
  console.error('[Worker] Redis connection error:', err);
  // ioredis tenta reconectar automaticamente por padrão
});

redis.on('connect', () => {
  console.log('[Worker] Connected to Redis.');
});

redis.on('ready', () => {
  console.log('[Worker] Redis client ready.');
});

// TODO: Confirmar o nome exato da fila usado no seu código que adiciona itens!
const queueName = 'ebook_generation_queue';

async function main() {
  console.log(`[Worker] Started. Waiting for jobs on queue: ${queueName}`);
  let currentProcessingItem: QueueItem | null = null; // Usar o tipo definido

  while (true) {
    try {
      currentProcessingItem = null; // Resetar a cada iteração
      console.log(`[Worker] Waiting for next job on ${queueName}...`);
      const result = await redis.brpop(queueName, 0);

      if (result && Array.isArray(result) && result.length === 2) {
        const jobString = result[1];
        try {
          const parsedData = JSON.parse(jobString);
          // Validar a estrutura do objeto parseado
          if (parsedData && typeof parsedData === 'object' && 'ebookId' in parsedData && typeof parsedData.ebookId === 'string' && 'pageIndex' in parsedData && typeof parsedData.pageIndex === 'number') {
              currentProcessingItem = parsedData as QueueItem; // Atribuir com o tipo correto
              await processQueueItem(currentProcessingItem);
          } else {
              console.error("[Worker] Received invalid job data structure after parsing:", parsedData);
          }
        } catch (parseError) {
          console.error("[Worker] Failed to parse JSON from queue:", jobString, parseError);
        }
      } else if (result !== null) {
         console.log('[Worker] BRPOP returned unexpected non-null result:', result);
         await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.log('[Worker] BRPOP returned null. Pausing before retry...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

    } catch (error) {
      console.error('[Worker] Error in main loop:', error);
      if (currentProcessingItem) {
          // Usar o tipo QueueItem explicitamente aqui também
          const failedItem: QueueItem = currentProcessingItem;
          console.error('[Worker] Failed while potentially processing item:', failedItem);
          try {
              // A verificação ainda é boa prática, mas o tipo já está definido
              await updatePageStatus(failedItem.ebookId, failedItem.pageIndex, "failed", "", "Worker main loop error");
          } catch (statusError) {
              console.error("[Worker] Failed to update status to failed after main loop error", statusError);
          }
      } else {
          console.error("[Worker] Error occurred before an item was successfully parsed/assigned.");
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Iniciar o processo principal
main().catch(error => {
    console.error("[Worker] Unhandled error in main execution:", error);
    process.exit(1);
}); 