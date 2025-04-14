import { type NextRequest, NextResponse } from "next/server";
import { getEbookState, getEbookPages, EbookQueuePage } from "@/lib/redis";

// Função auxiliar para sanitizar nomes de arquivos
function sanitizeFilename(filename: string): string {
  // Remover caracteres inválidos e substituir espaços
  return filename.replace(/[^a-z0-9\.\-_]/gi, '_').replace(/\s+/g, '_');
}

export async function GET(
  request: NextRequest,
  { params }: { params: { ebookId: string } }
) {
  try {
    const ebookId = params.ebookId;

    if (!ebookId) {
      return NextResponse.json({ success: false, error: "Ebook ID is required" }, { status: 400 });
    }

    // Obter o estado e as páginas do ebook
    const [ebookState, pages] = await Promise.all([
      getEbookState(ebookId),
      getEbookPages(ebookId)
    ]);

    // Verificar se o ebook existe
    if (!ebookState) {
      return NextResponse.json({ success: false, error: "Ebook not found" }, { status: 404 });
    }

    // Verificar se a geração está completa (ou pelo menos parcialmente)
    if (ebookState.status !== "completed" && ebookState.status !== "partial" && ebookState.completedPages === 0) {
         return NextResponse.json({ success: false, error: "Ebook generation is not complete or has not started." }, { status: 400 });
    }

    // Verificar se pages é um array válido
     if (!Array.isArray(pages)) {
          console.error("Erro: getEbookPages não retornou um array:", pages);
          return NextResponse.json({ success: false, error: "Failed to retrieve ebook pages." }, { status: 500 });
     }

    // Filtrar e ordenar as páginas completas
    const completedPages = pages
      .filter((page): page is EbookQueuePage & { content: string } => page.status === "completed" && typeof page.content === 'string')
      .sort((a, b) => a.pageIndex - b.pageIndex);

     if (completedPages.length === 0) {
         return NextResponse.json({ success: false, error: "No completed pages found to download." }, { status: 400 });
    }

    // Montar o conteúdo do ebook
    let ebookContent = `Título: ${ebookState.title}\n`;
    ebookContent += `Descrição: ${ebookState.description}\n\n`;
    ebookContent += `=====================================\n\n`;

    completedPages.forEach((page) => {
      ebookContent += `## Página ${page.pageIndex + 1}: ${page.pageTitle}\n\n`;
      ebookContent += `${page.content}\n\n`;
      ebookContent += `-------------------------------------\n\n`;
    });
    
    if (ebookState.status === "partial" || ebookState.status === "processing" || ebookState.status === "failed") {
        ebookContent += `\nAVISO: Este ebook pode estar incompleto. Status atual: ${ebookState.status}. Páginas completas: ${ebookState.completedPages}/${ebookState.totalPages}.\n`;
    }

    // Sanitizar o nome do arquivo
    const filename = sanitizeFilename(ebookState.title || 'ebook') + ".txt";

    // Criar a resposta com o conteúdo e os cabeçalhos corretos
    const response = new NextResponse(ebookContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

    return response;

  } catch (error) {
    console.error("Error generating download:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error generating download" },
      { status: 500 }
    );
  }
} 