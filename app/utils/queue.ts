import {
  getRedisClient,
  getNextQueueItem as getNextQueueItemRedis,
  updatePageStatus as updatePageStatusRedis,
} from "@/lib/redis"

// Função para obter o próximo item da fila
export async function getNextQueueItem(): Promise<{ ebookId: string; pageIndex: number } | null> {
  return getNextQueueItemRedis()
}

// Função para processar um item da fila (gerar o conteúdo da página)
export async function processQueueItem(item: { ebookId: string; pageIndex: number }): Promise<boolean> {
  try {
    const { ebookId, pageIndex } = item

    // Obter o cliente Redis
    const client = getRedisClient()

    if (!client) {
      console.error("Cliente Redis não está disponível")
      return false
    }

    // Atualizar o status da página para "processing"
    await updatePageStatus(ebookId, pageIndex, "processing")

    // Simular o processamento da página (substitua isso pela lógica real)
    // await new Promise((resolve) => setTimeout(resolve, 2000))

    // Atualizar o status da página para "completed"
    await updatePageStatus(ebookId, pageIndex, "completed", `Conteúdo gerado para a página ${pageIndex + 1}`)

    return true
  } catch (error) {
    console.error("Erro ao processar item da fila:", error)
    return false
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
  await updatePageStatusRedis(ebookId, pageIndex, status, content, error)
}
