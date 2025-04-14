import { type NextRequest, NextResponse } from "next/server";
import { generateEbookDescription } from "@/lib/ebook-generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title } = body;

    if (!title) {
      return NextResponse.json({ success: false, error: "Title is required" }, { status: 400 });
    }

    // Chamar a função de geração no backend
    const description = await generateEbookDescription(title);

    return NextResponse.json({ success: true, description });

  } catch (error) {
    console.error("Error in /api/generate-description:", error);
    // Retornar o erro que veio da função generateEbookDescription ou um erro genérico
    const errorMessage = error instanceof Error ? error.message : "Failed to generate description";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 } // Usar 500 para erros do servidor
    );
  }
} 