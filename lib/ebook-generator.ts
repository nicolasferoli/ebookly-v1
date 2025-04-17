
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
      prompt: `Crie uma descrição breve e atraente para um ebook com o título \"${title}\". \n      A descrição deve ter entre 100 e 150 palavras e explicar o que o leitor vai aprender, \n      para quem o ebook é destinado e quais são os principais benefícios de lê-lo.`,
      maxTokens: 300,
    })

    return text
  } catch (error) {
    console.error("Error generating ebook description:", error)
    // Incluir mensagem do erro original
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Falha ao gerar descrição do ebook: ${errorMessage}`)
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
}

export type EbookStructure = {
  title: string
  description: string
  pages: EbookPage[]
}

// Cache para armazenar conteúdo parcial
const pageContentCache: Record<string, string> = {}

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
      error: error instanceof Error ? error.message : String(error),
    })
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Falha ao gerar estrutura do ebook: ${errorMessage}`)
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

/* export async function generateFullEbook(title: string, description: string): Promise<string[]> {
  // Esta função dependia de generateFullEbookWithProgress, que foi removido.
  // Se necessário, pode ser reimplementada usando a lógica de fila/worker.
  console.warn("generateFullEbook is deprecated and currently non-functional.");
  return [];
} */
