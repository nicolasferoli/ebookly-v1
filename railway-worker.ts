import { 
  getRedisClient, 
  getEbookState, 
  getEbookPages, 
  updatePageStatus,
  checkRedisConnection,
  getEbookPage,
  EBOOK_PAGE_PREFIX,
  EBOOK_PAGES_PREFIX,
  type EbookQueuePage // <-- Adicionar tipo aqui
} from './lib/redis'; 
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Definir tipo para o item da fila
type QueueItem = {
  ebookId: string;
  pageIndex: number;
};

// Atenção: Este script é para ser executado fora do ambiente Next.js/Vercel.
// Certifique-se de que as variáveis de ambiente (OPENAI_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN)
// estejam disponíveis no ambiente onde este worker será executado (ex: Railway).

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

// Verificar variáveis de ambiente necessárias no início
if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error("Missing environment variables: KV_REST_API_URL and KV_REST_API_TOKEN are required.");
    process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
    console.warn("Missing environment variable: OPENAI_API_KEY is required for generating content.");
    // Poderia sair com process.exit(1) aqui também se for crítico
}

// TODO: Confirmar o nome exato da fila usado no seu código que adiciona itens!
const queueName = `${EBOOK_PAGES_PREFIX}pages`;

async function main() {
  console.log("[Worker] Initializing...");

  // Obter o cliente Redis configurado de lib/redis
  const redisClient = getRedisClient();

  if (!redisClient) {
    console.error("[Worker] Failed to initialize Redis client from lib. Exiting.");
    process.exit(1);
  }

  // Verificar a conexão inicial
  const isConnected = await checkRedisConnection();
  if (!isConnected) {
      console.error("[Worker] Initial Redis connection check failed. Exiting.");
      process.exit(1);
  }
  console.log("[Worker] Initial Redis connection successful.");


  console.log(`[Worker] Started. Waiting for jobs on queue: ${queueName}`);
  let currentProcessingItem: QueueItem | null = null; 

  while (true) {
    try {
      currentProcessingItem = null; // Resetar a cada iteração
      console.log(`[Worker] Checking for next job on ${queueName}... (Using rpop)`);
      
      // Esperar string OU QueueItem de rpop
      const jobData = await redisClient.rpop<string | QueueItem>(queueName); 

      if (jobData) { // Se encontrou um job
        let parsedData: QueueItem | null = null;
        try {
          // Verificar se já é um objeto (auto-parsed?)
          if (typeof jobData === 'object' && jobData !== null) {
             // Validar a estrutura do objeto recebido
             // Com a dica de tipo <string | QueueItem>, TS deve permitir acesso direto aqui
             if (jobData.ebookId && typeof jobData.ebookId === 'string' && typeof jobData.pageIndex === 'number') {
                parsedData = jobData; // Usar diretamente
             } else {
                console.error("[Worker] Received invalid object structure directly from rpop:", jobData);
             }
          } 
          // Se for uma string, tentar fazer o parse
          else if (typeof jobData === 'string') {
            const tempParsed = JSON.parse(jobData) as QueueItem;
            // Validar a estrutura após parse
             if (tempParsed && typeof tempParsed === 'object' && tempParsed.ebookId && typeof tempParsed.pageIndex === 'number') {
                 parsedData = tempParsed;
             } else {
                 console.error("[Worker] Invalid job data structure after parsing string:", tempParsed);
             }
          }
           else {
                // Cobrir outros tipos inesperados, embora improvável com <string | QueueItem>
                console.error("[Worker] Received unexpected data type from rpop:", typeof jobData);
           }

          // Processar apenas se parsedData for válido
          if (parsedData) {
              currentProcessingItem = parsedData;
              await processQueueItem(currentProcessingItem);
          }

        } catch (error) { // Pegar erros do JSON.parse ou outros erros inesperados no bloco try
          console.error("[Worker] Failed to parse or validate job data:", jobData, error);
        }
      } else {
        // Fila vazia, esperar um pouco antes de verificar novamente
        // console.log('[Worker] Queue empty. Pausing before next check...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1 segundo
      }

    } catch (error) {
      console.error('[Worker] Error in main loop:', error);
      // Verificar se a conexão Redis ainda é válida antes de tentar atualizar o status
      const connectionStillValid = await checkRedisConnection(); 
      if (currentProcessingItem && connectionStillValid) {
          const failedItem: QueueItem = currentProcessingItem; 
          console.error('[Worker] Failed while potentially processing item:', failedItem);
          try {
              await updatePageStatus(failedItem.ebookId, failedItem.pageIndex, "failed", "", "Worker main loop error");
          } catch (statusError) {
              console.error("[Worker] Failed to update status to failed after main loop error", statusError);
          }
      } else if (!connectionStillValid) {
           console.error("[Worker] Redis connection lost. Cannot update status for item:", currentProcessingItem);
           // Implementar lógica de reconexão ou saída se necessário
           await new Promise(resolve => setTimeout(resolve, 10000)); // Pausa maior se a conexão cair
      } else {
          console.error("[Worker] Error occurred before an item was successfully parsed/assigned.");
      }
      // Pausa antes de tentar novamente no loop principal
      if (!connectionStillValid) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
}

// Iniciar o processo principal
main().catch(error => {
    console.error("[Worker] Unhandled error in main execution:", error);
    process.exit(1); // Sai se a função main falhar catastroficamente
}); 