import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const countParam = searchParams.get("count")
    const count = countParam ? Number.parseInt(countParam, 10) : 5

    // Chamar a API do worker SEM esperar (fire and forget) - COMENTADO POIS O WORKER AGORA É SEPARADO
    /*
    fetch(`${request.nextUrl.origin}/api/worker?count=${count}`, {
      method: "GET",
    }).catch(err => {
      // Logar erro caso a chamada inicial falhe, mas não travar a resposta
      console.error("Failed to trigger /api/worker:", err);
    });
    */
    console.log("API /api/start-worker chamada, mas o worker agora roda separadamente e não precisa ser iniciado por aqui.");

    // Retornar sucesso imediatamente
    return NextResponse.json({ success: true, message: "Worker started (runs independently)" })

  } catch (error) {
    console.error("Error starting worker:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
