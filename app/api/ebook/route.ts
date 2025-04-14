import { type NextRequest, NextResponse } from "next/server"
import { createEbookQueue } from "@/lib/redis"
// Importar a função de geração de estrutura
import { generateEbookStructure } from "@/lib/ebook-generator"

// Função para gerar títulos de páginas genéricos
/*
function generateGenericPageTitles(title: string, count = 30): string[] {
  const sections = [
    "Introdução",
    "Conceitos Fundamentais",
    "Primeiros Passos",
    "Estratégias Principais",
    "Técnicas Avançadas",
    "Estudos de Caso",
    "Ferramentas e Recursos",
    "Melhores Práticas",
    "Desafios Comuns",
    "Tendências Futuras",
    "Considerações Finais",
  ]

  return Array.from({ length: count }, (_, i) => {
    const sectionIndex = Math.floor(i / 3)
    const section = sections[sectionIndex % sections.length]
    const partNumber = Math.floor(i / sections.length) + 1
    const partSuffix = partNumber > 1 ? ` - Parte ${partNumber}` : ""

    return `${section}${partSuffix}: ${title}`
  })
}
*/

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ success: false, error: "Ebook ID is required" }, { status: 400 })
    }

    // Importar as funções necessárias apenas quando precisar
    const { getEbookState, getEbookPages } = await import("@/lib/redis")

    // Obter o estado do ebook
    try {
      const state = await getEbookState(id)

      if (!state) {
        return NextResponse.json({ success: false, error: "Ebook not found" }, { status: 404 })
      }

      // Obter as páginas do ebook
      try {
        const pages = await getEbookPages(id)

        // Verificar se pages é um array
        if (!Array.isArray(pages)) {
          console.error("Erro: pages não é um array:", pages)
          return NextResponse.json({
            success: true,
            state,
            pages: [],
            pagesError: "Erro ao obter páginas: o resultado não é um array",
          })
        }

        return NextResponse.json({
          success: true,
          state,
          pages: pages.map((page) => ({
            index: page.pageIndex,
            content: page.content,
          })),
        })
      } catch (pagesError) {
        console.error("Error getting ebook pages:", pagesError)
        // Retornar o estado mesmo se não conseguir obter as páginas
        return NextResponse.json({
          success: true,
          state,
          pages: [],
          pagesError: pagesError instanceof Error ? pagesError.message : "Error getting ebook pages",
        })
      }
    } catch (stateError) {
      console.error("Error getting ebook state:", stateError)
      return NextResponse.json(
        {
          success: false,
          error: `Error getting ebook state: ${stateError instanceof Error ? stateError.message : "Unknown error"}`,
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Error getting ebook:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verificar se o corpo da requisição é válido
    let requestData
    try {
      requestData = await request.json()
    } catch (parseError) {
      console.error("Error parsing request body:", parseError)
      return NextResponse.json({ success: false, error: "Invalid request body. JSON expected." }, { status: 400 })
    }

    // Validar os campos obrigatórios
    const { title, description, contentMode, pageCount } = requestData

    if (!title || !description) {
      return NextResponse.json({ success: false, error: "Title and description are required" }, { status: 400 })
    }

    // Usar o pageCount da requisição ou o valor padrão de 10 (ou outro valor que faça sentido)
    const numberOfPages = pageCount && !isNaN(Number(pageCount)) ? Number(pageCount) : 10

    // Gerar a estrutura do ebook (sumário) usando IA
    console.log(`Gerando estrutura para "${title}" com ${numberOfPages} páginas...`) // Log
    // Criar um callback de progresso vazio, pois a API não precisa lidar com isso
    const onProgressCallback = (step: any) => { 
      console.log(`Progresso da estrutura: ${step.type} - ${step.progress}%`) 
    }; 
    const ebookStructure = await generateEbookStructure(
      title,
      description,
      numberOfPages,
      onProgressCallback 
    )

    // Extrair os títulos das páginas geradas
    const pageTitles = ebookStructure.pages.map((page) => page.title)

    // Log dos títulos gerados
    console.log(`Títulos gerados (${pageTitles.length}):`);
    pageTitles.forEach((t, i) => console.log(`${i + 1}. ${t}`));

    // Criar o ebook na fila com os títulos reais
    const { ebookId, state } = await createEbookQueue(title, description, contentMode || "MEDIUM", pageTitles)

    return NextResponse.json({
      success: true,
      message: "Ebook structure generated and queued successfully",
      ebookId,
      state,
    })
  } catch (error) {
    console.error("Error creating ebook:", error)
    // Retornar um erro mais informativo se a geração da estrutura falhar
    const errorMessage = error instanceof Error ? error.message : "Unknown error creating ebook"
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: error instanceof Error && error.cause ? error.cause : undefined, // Adicionar causa se existir
      },
      { status: 500 },
    )
  }
}
