import { type NextRequest, NextResponse } from "next/server"
import { getRedisClient } from "@/lib/redis"

// Prefixo para as chaves da biblioteca no Redis
const BIBLIOTECA_PREFIX = "biblioteca:"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      return NextResponse.json({ success: false, error: "Cliente Redis não está disponível" }, { status: 500 })
    }

    // Se um ID específico for fornecido, retornar apenas esse ebook
    if (id) {
      const ebookData = await client.get(`${BIBLIOTECA_PREFIX}${id}`)

      if (!ebookData) {
        return NextResponse.json({ success: false, error: "Ebook não encontrado" }, { status: 404 })
      }

      try {
        const ebook = typeof ebookData === "object" ? ebookData : JSON.parse(ebookData as string)
        return NextResponse.json({ success: true, ebook })
      } catch (parseError) {
        console.error("Erro ao fazer parse do ebook:", parseError)
        return NextResponse.json({ success: false, error: "Erro ao processar dados do ebook" }, { status: 500 })
      }
    }

    // Caso contrário, listar todos os ebooks na biblioteca
    try {
      // Obter todas as chaves de ebooks na biblioteca
      const keys = await client.keys(`${BIBLIOTECA_PREFIX}*`)

      if (!keys || keys.length === 0) {
        return NextResponse.json({ success: true, ebooks: [] })
      }

      // Obter os dados de cada ebook
      const ebooksData = await Promise.all(
        keys.map(async (key) => {
          const data = await client.get(key)
          if (!data) return null

          try {
            return typeof data === "object" ? data : JSON.parse(data as string)
          } catch (parseError) {
            console.error(`Erro ao fazer parse do ebook ${key}:`, parseError)
            return null
          }
        }),
      )

      // Filtrar ebooks nulos (que não puderam ser processados)
      const ebooks = ebooksData.filter(Boolean)

      return NextResponse.json({ success: true, ebooks })
    } catch (error) {
      console.error("Erro ao listar ebooks:", error)
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Erro na API de biblioteca:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verificar se o corpo da requisição é válido
    let ebookData
    try {
      ebookData = await request.json()
    } catch (parseError) {
      console.error("Erro ao processar corpo da requisição:", parseError)
      return NextResponse.json({ success: false, error: "Corpo da requisição inválido" }, { status: 400 })
    }

    // Validar os campos obrigatórios
    if (!ebookData.id || !ebookData.title) {
      return NextResponse.json({ success: false, error: "ID e título são obrigatórios" }, { status: 400 })
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      return NextResponse.json({ success: false, error: "Cliente Redis não está disponível" }, { status: 500 })
    }

    // Salvar o ebook na biblioteca
    await client.set(`${BIBLIOTECA_PREFIX}${ebookData.id}`, JSON.stringify(ebookData))

    return NextResponse.json({
      success: true,
      message: "Ebook salvo na biblioteca com sucesso",
      ebookId: ebookData.id,
    })
  } catch (error) {
    console.error("Erro ao salvar ebook na biblioteca:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ success: false, error: "ID do ebook é obrigatório" }, { status: 400 })
    }

    // Verificar se o cliente Redis está disponível
    const client = getRedisClient()
    if (!client) {
      return NextResponse.json({ success: false, error: "Cliente Redis não está disponível" }, { status: 500 })
    }

    // Verificar se o ebook existe
    const exists = await client.exists(`${BIBLIOTECA_PREFIX}${id}`)

    if (!exists) {
      return NextResponse.json({ success: false, error: "Ebook não encontrado" }, { status: 404 })
    }

    // Excluir o ebook da biblioteca
    await client.del(`${BIBLIOTECA_PREFIX}${id}`)

    return NextResponse.json({
      success: true,
      message: "Ebook excluído com sucesso",
    })
  } catch (error) {
    console.error("Erro ao excluir ebook:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 500 },
    )
  }
}
