import { type NextRequest, NextResponse } from "next/server";
import { getEbookState, getEbookPages, EbookQueuePage } from "@/lib/redis";
import PDFDocument from 'pdfkit'; // Importar pdfkit
import { PassThrough } from 'stream'; // Importar stream para buffer

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

    // --- Geração do PDF --- 
    const doc = new PDFDocument({ bufferPages: true, size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];
    
    const pdfStream = new PassThrough();
    pdfStream.on('data', (chunk) => buffers.push(chunk));
    doc.pipe(pdfStream);

    // Adicionar Título e Descrição (Usando fontes padrão PDF)
    doc.font('Helvetica-Bold').fontSize(24).text(ebookState.title, { align: 'center' });
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(12).text(ebookState.description);
    doc.moveDown(3);

    // Adicionar Páginas do Ebook (Usando fontes padrão PDF)
    completedPages.forEach((page, index) => {
      if (index > 0) {
        doc.addPage();
      }
      // Título da Página
      doc.font('Helvetica-Bold').fontSize(16).text(`Página ${page.pageIndex + 1}: ${page.pageTitle}`, { underline: true });
      doc.moveDown(1);
      // Conteúdo da Página
      doc.font('Helvetica').fontSize(11).text(page.content);
    });

    // Adicionar aviso se incompleto (Usando fontes padrão PDF)
     if (ebookState.status === "partial" || ebookState.status === "processing" || ebookState.status === "failed") {
        doc.addPage();
        doc.font('Helvetica-Oblique').fontSize(10).text(`AVISO: Este ebook pode estar incompleto. Status atual: ${ebookState.status}. Páginas completas: ${ebookState.completedPages}/${ebookState.totalPages}.`);
    }

    // Finalizar o PDF
    doc.end();

    // Aguardar o stream terminar para ter todos os buffers
    await new Promise<void>((resolve) => {
        pdfStream.on('end', resolve);
    });

    // Combinar os buffers
    const pdfBuffer = Buffer.concat(buffers);
    // ------------------------

    // Sanitizar o nome do arquivo e mudar extensão para .pdf
    const filename = sanitizeFilename(ebookState.title || 'ebook') + ".pdf";

    // Criar a resposta com o buffer do PDF e os cabeçalhos corretos
    const response = new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(), // Adicionar Content-Length
      },
    });

    return response;

  } catch (error) {
    console.error("Error generating PDF download:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error generating PDF download" },
      { status: 500 }
    );
  }
} 