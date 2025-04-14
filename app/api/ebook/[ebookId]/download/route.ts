import { type NextRequest, NextResponse } from "next/server";
import { getEbookState, getEbookPages, EbookQueuePage } from "@/lib/redis";
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Função auxiliar para sanitizar nomes de arquivos
function sanitizeFilename(filename: string): string {
  // Remover caracteres inválidos e substituir espaços
  return filename.replace(/[^a-z0-9\.\-_]/gi, '_').replace(/\s+/g, '_');
}

// Função para gerar o HTML do Ebook
function generateEbookHtml(state: any, pages: EbookQueuePage[]): string {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${state.title}</title>
      <style>
        body { font-family: sans-serif; line-height: 1.6; margin: 40px; }
        h1 { text-align: center; border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 30px; }
        h2 { margin-top: 40px; border-bottom: 1px solid #eee; padding-bottom: 5px; page-break-before: always; }
        h2:first-of-type { page-break-before: avoid; }
        p.description { font-style: italic; margin-bottom: 40px; }
        .page-content { margin-top: 15px; white-space: pre-wrap; } /* Preserve line breaks */
        .warning { color: #888; font-style: italic; margin-top: 50px; border-top: 1px solid #ccc; padding-top: 10px; }

        /* Adiciona números de página no rodapé */
        @page {
          @bottom-center {
            content: counter(page);
            font-size: 9pt;
            color: #888;
          }
        }
      </style>
    </head>
    <body>
      <h1>${state.title}</h1>
      <p class="description">${state.description}</p>
  `;

  pages.forEach(page => {
    html += `
      <h2>Página ${page.pageIndex + 1}: ${page.pageTitle}</h2>
      <div class="page-content">${page.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    `; // Basic HTML escaping for content
  });

  if (state.status === "partial" || state.status === "processing" || state.status === "failed") {
    html += `<p class="warning">AVISO: Este ebook pode estar incompleto. Status atual: ${state.status}. Páginas completas: ${state.completedPages}/${state.totalPages}.</p>`;
  }

  html += `
    </body>
    </html>
  `;
  return html;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { ebookId: string } }
) {
  let browser = null;
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

    console.log(`Gerando PDF para Ebook ${ebookId} com ${completedPages.length} páginas usando Puppeteer (@sparticuz/chromium)...`);

    // Gerar o conteúdo HTML
    const htmlContent = generateEbookHtml(ebookState, completedPages);

    // Configurar Puppeteer com @sparticuz/chromium
    // Não precisamos mais buscar as fontes, pois o Chromium as terá
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(), // Chamar a função
      headless: chromium.headless, 
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Gerar o PDF
    console.log("Gerando buffer PDF...");
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '50px',
        right: '50px',
        bottom: '50px',
        left: '50px',
      },
    });
    console.log(`PDF gerado com sucesso. Tamanho: ${pdfBuffer.length} bytes`);

    await browser.close();
    browser = null; // Marcar como fechado

    // --- Retornar o PDF --- 
    const filename = sanitizeFilename(ebookState.title || 'ebook') + ".pdf";
    const response = new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
    return response;

  } catch (error) {
    console.error("Erro ao gerar PDF download com Puppeteer:", error);
    if (browser) {
      console.log("Fechando browser devido a erro...");
      await browser.close();
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error generating PDF download" },
      { status: 500 }
    );
  }
} 