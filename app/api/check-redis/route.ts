import { NextResponse } from "next/server"

export async function GET() {
  try {
    // Verificar se as variáveis de ambiente estão definidas
    const restApiUrl = process.env.KV_REST_API_URL || ""
    const directUrl = process.env.REDIS_URL || process.env.KV_URL || ""
    const redisToken =
      process.env.KV_REST_API_TOKEN || process.env.REDIS_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || ""

    // Mostrar informações sobre as variáveis de ambiente disponíveis
    const envInfo = {
      KV_REST_API_URL: process.env.KV_REST_API_URL ? "Configurado" : "Não configurado",
      KV_URL: process.env.KV_URL ? "Configurado" : "Não configurado",
      REDIS_URL: process.env.REDIS_URL ? "Configurado" : "Não configurado",
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? "Configurado" : "Não configurado",
      KV_REST_API_READ_ONLY_TOKEN: process.env.KV_REST_API_READ_ONLY_TOKEN ? "Configurado" : "Não configurado",
      REDIS_TOKEN: process.env.REDIS_TOKEN ? "Configurado" : "Não configurado",
    }

    // Verificar se temos as variáveis necessárias
    if (!restApiUrl && !directUrl) {
      return NextResponse.json({
        success: false,
        connected: false,
        error: "URL do Redis não está definida",
        envInfo,
        helpMessage: "Configure a variável de ambiente KV_REST_API_URL com a URL da API REST do Upstash.",
      })
    }

    if (!redisToken) {
      return NextResponse.json({
        success: false,
        connected: false,
        error: "Token do Redis não está definido",
        envInfo,
        helpMessage: "Configure a variável de ambiente KV_REST_API_TOKEN com o token da API REST do Upstash.",
      })
    }

    // Importar a função de verificação do Redis apenas quando necessário
    // para evitar erros de inicialização
    const { checkRedisConnection } = await import("@/lib/redis")

    // Verificar a conexão com o Redis com um timeout
    let isConnected = false
    try {
      // Adicionar um timeout para a verificação
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout na conexão com o Redis")), 5000)
      })

      const connectionPromise = checkRedisConnection()

      // Usar Promise.race para implementar o timeout
      isConnected = await Promise.race([connectionPromise, timeoutPromise])
    } catch (connectionError) {
      console.error("Erro na verificação da conexão com o Redis:", connectionError)
      return NextResponse.json({
        success: false,
        connected: false,
        error: connectionError instanceof Error ? connectionError.message : "Falha na conexão com o Redis",
        envInfo,
        helpMessage: "Verifique se as credenciais do Redis estão corretas e se o serviço está acessível.",
      })
    }

    return NextResponse.json({
      success: true,
      connected: isConnected,
      envInfo,
      helpMessage: isConnected
        ? "Conexão com o Redis estabelecida com sucesso!"
        : "Não foi possível conectar ao Redis. Verifique suas credenciais.",
    })
  } catch (error) {
    console.error("Erro ao verificar conexão com o Redis:", error)

    // Garantir que sempre retornamos um JSON válido
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : "Erro desconhecido ao verificar conexão com o Redis",
        envInfo: {
          KV_REST_API_URL: process.env.KV_REST_API_URL ? "Configurado" : "Não configurado",
          KV_URL: process.env.KV_URL ? "Configurado" : "Não configurado",
          REDIS_URL: process.env.REDIS_URL ? "Configurado" : "Não configurado",
          KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? "Configurado" : "Não configurado",
          KV_REST_API_READ_ONLY_TOKEN: process.env.KV_REST_API_READ_ONLY_TOKEN ? "Configurado" : "Não configurado",
          REDIS_TOKEN: process.env.REDIS_TOKEN ? "Configurado" : "Não configurado",
        },
        helpMessage: "Ocorreu um erro inesperado. Verifique os logs do servidor para mais detalhes.",
      },
      { status: 500 },
    )
  }
}
