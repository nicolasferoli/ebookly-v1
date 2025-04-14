import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const countParam = searchParams.get("count")
    const count = countParam ? Number.parseInt(countParam, 10) : 5

    // Chamar a API do worker
    const response = await fetch(`${request.nextUrl.origin}/api/worker?count=${count}`, {
      method: "GET",
    })

    const data = await response.json()

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error starting worker:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
