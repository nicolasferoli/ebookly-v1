import { type NextRequest, NextResponse } from "next/server"
import { getNextQueueItem, updatePageStatus, getEbookState, getEbookPages } from "@/lib/redis"
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"

// Configurações de conteúdo
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
}

// Função para gerar o conteúdo de uma página (atualizada para receber títulos)
async function generatePageContent(
  ebookTitle: string,
  ebookDescription: string,
  pageTitle: string,
  pageIndex: number,
  contentMode: string,
  allPageTitles: string[] // Novo parâmetro
): Promise<string> {
  try {
    const mode = CONTENT_MODES[contentMode as keyof typeof CONTENT_MODES] || CONTENT_MODES.MEDIUM;

    // Construir o sumário para o prompt
    const tableOfContents = allPageTitles
      .map((title, index) => `${index + 1}. ${title}${index === pageIndex ? " <-- VOCÊ ESTÁ AQUI" : ""}`)
      .join("\n");

    // Criar o prompt atualizado
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

    console.log(`Gerando conteúdo para página ${pageIndex + 1} com prompt contextualizado.`);
    // Gerar o conteúdo
    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt,
      maxTokens: mode.maxTokens + 50, // Um pouco mais de folga para prompts maiores
    });

    return text;
  } catch (error) {
    console.error(`Error generating page content for page ${pageIndex}:`, error);
    throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Função para processar um item da fila (atualizada)
async function processQueueItem(item: { ebookId: string; pageIndex: number }): Promise<boolean> {
  try {
    const { ebookId, pageIndex } = item;

    // Obter o estado do ebook E TODAS as páginas para pegar os títulos
    const [ebookState, allPages] = await Promise.all([
        getEbookState(ebookId),
        getEbookPages(ebookId) // Buscar todas as páginas
    ]);

    if (!ebookState) {
      console.error(`Ebook ${ebookId} not found for page ${pageIndex}`);
      return false;
    }
    // Verificar se allPages é um array e não está vazio
    if (!Array.isArray(allPages) || allPages.length === 0) {
       console.error(`Page data not found or invalid for ebook ${ebookId}`);
       await updatePageStatus(ebookId, pageIndex, "failed", "", "Page data not found or invalid in Redis");
       return false;
    }

    // Encontrar os dados da página atual na lista
    const currentPageData = allPages.find(p => p.pageIndex === pageIndex);
    if (!currentPageData) {
      console.error(`Current page data (${pageIndex}) not found in list for ebook ${ebookId}`);
       await updatePageStatus(ebookId, pageIndex, "failed", "", "Current page data not found in list");
       return false;
    }

    // Extrair todos os títulos ordenados
    const allPageTitles = allPages
                           .sort((a, b) => a.pageIndex - b.pageIndex)
                           .map(p => p.pageTitle);

    // Marcar a página como em processamento
    await updatePageStatus(ebookId, pageIndex, "processing");

    // Gerar o conteúdo da página, passando a lista de títulos
    const content = await generatePageContent(
      ebookState.title,
      ebookState.description,
      currentPageData.pageTitle, // Usar o título real da página atual
      pageIndex,
      ebookState.contentMode,
      allPageTitles // Passar todos os títulos
    );

    // Marcar a página como concluída
    await updatePageStatus(ebookId, pageIndex, "completed", content);

    return true;
  } catch (error) {
    console.error(`Error processing queue item ${item.ebookId}-${item.pageIndex}:`, error);

    // Marcar a página como falha
    try {
      const { ebookId, pageIndex } = item;
      await updatePageStatus(ebookId, pageIndex, "failed", "", error instanceof Error ? error.message : "Unknown error");
    } catch (updateError) {
      console.error("Error updating page status after failure:", updateError);
    }

    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const countParam = searchParams.get("count")
    const count = countParam ? Number.parseInt(countParam, 10) : 1

    const results = []

    // Processar vários itens da fila
    for (let i = 0; i < count; i++) {
      try {
        const item = await getNextQueueItem()

        if (!item) {
          console.log("Fila vazia, parando processamento")
          break // Fila vazia
        }

        console.log(`Processando item da fila: ebook ${item.ebookId}, página ${item.pageIndex}`)

        try {
          const success = await processQueueItem(item)
          results.push({ ...item, success })
        } catch (processError) {
          console.error("Error in queue item processing:", processError)
          results.push({
            ...item,
            success: false,
            error: processError instanceof Error ? processError.message : "Unknown error",
          })
        }
      } catch (itemError) {
        console.error("Error getting queue item:", itemError)
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
    })
  } catch (error) {
    console.error("Error processing queue:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
