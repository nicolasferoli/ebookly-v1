import { type NextRequest, NextResponse } from "next/server"
import { getNextQueueItem, updatePageStatus, getEbookState, getEbookPage } from "@/lib/redis"
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

// Função para gerar o conteúdo de uma página
async function generatePageContent(
  ebookTitle: string,
  ebookDescription: string,
  pageTitle: string,
  pageIndex: number,
  contentMode: string,
): Promise<string> {
  try {
    // Obter configurações do modo de conteúdo
    const mode = CONTENT_MODES[contentMode as keyof typeof CONTENT_MODES] || CONTENT_MODES.MEDIUM

    // Criar o prompt para a página
    const prompt = `Você está escrevendo a página ${pageIndex + 1} de um ebook com o título "${ebookTitle}".
    
    Descrição do ebook: "${ebookDescription}"
    
    Título desta página: "${pageTitle}"
    
    Escreva o conteúdo desta página. O conteúdo deve:
    1. Ser informativo e relevante
    2. ${mode.promptSuffix}
    3. Ser escrito em português do Brasil com linguagem clara
    4. Estar diretamente relacionado ao título da página
    
    Escreva APENAS o conteúdo da página, sem incluir o título ou número da página.`

    // Gerar o conteúdo
    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt,
      maxTokens: mode.maxTokens,
    })

    return text
  } catch (error) {
    console.error("Error generating page content:", error)
    throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : "Unknown error"}`)
  }
}

// Função para processar um item da fila
async function processQueueItem(item: { ebookId: string; pageIndex: number }): Promise<boolean> {
  try {
    const { ebookId, pageIndex } = item

    // Obter o estado do ebook E os detalhes da página específica
    const [ebookState, pageData] = await Promise.all([
        getEbookState(ebookId),
        getEbookPage(ebookId, pageIndex) // Usar a nova função
    ]);

    if (!ebookState) {
      console.error(`Ebook ${ebookId} not found for page ${pageIndex}`)
      // Não podemos atualizar o status se o ebook não existe
      return false
    }
    if (!pageData) {
      console.error(`Page data not found for ebook ${ebookId}, page ${pageIndex}`)
       // Tentar marcar como falha se o estado do ebook existir
      await updatePageStatus(ebookId, pageIndex, "failed", "", "Page data not found in Redis")
      return false
    }

    // Marcar a página como em processamento
    await updatePageStatus(ebookId, pageIndex, "processing")

    // Usar o título real da página obtido do Redis
    const pageTitle = pageData.pageTitle

    // Gerar o conteúdo da página
    const content = await generatePageContent(
      ebookState.title,
      ebookState.description,
      pageTitle, // <- Título real aqui
      pageIndex,
      ebookState.contentMode,
    )

    // Marcar a página como concluída
    await updatePageStatus(ebookId, pageIndex, "completed", content)

    return true
  } catch (error) {
    console.error("Error processing queue item:", error)

    // Marcar a página como falha
    try {
      const { ebookId, pageIndex } = item
      await updatePageStatus(ebookId, pageIndex, "failed", "", error instanceof Error ? error.message : "Unknown error")
    } catch (updateError) {
      console.error("Error updating page status:", updateError)
    }

    return false
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
