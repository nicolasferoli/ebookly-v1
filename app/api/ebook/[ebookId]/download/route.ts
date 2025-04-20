import { type NextRequest, NextResponse } from "next/server";
import { getEbookState, getEbookPages, EbookQueuePage } from "@/lib/redis";
import puppeteer, { type Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Define a interface para o contexto da rota
// interface RouteContext {
//   params: {
//     ebookId: string;
//   };
// }

// Função auxiliar para sanitizar nomes de arquivos
function sanitizeFilename(filename: string): string {
  // Remover caracteres inválidos e substituir espaços
  return filename.replace(/[^a-z0-9\.\-_]/gi, '_').replace(/\s+/g, '_');
}

// Função para gerar o HTML do Ebook
function generateEbookHtml(state: any, pages: EbookQueuePage[]): string {
  // Helper para escapar HTML e converter markdown bold
  const formatContent = (content: string): string => {
    if (!content) return "";
    // 1. Substituir **texto** por <strong>texto</strong>
    let formatted = content.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    // 2. Escapar < e > - REMOVIDO PARA PERMITIR O <strong>
    // formatted = formatted.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // TODO: Consider using a proper sanitizer/markdown library if input needs more robust handling
    return formatted;
  };

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${state.title}</title>
      <style>
        /* Importar fontes Roboto */
        @font-face {
          font-family: 'Roboto';
          font-style: normal;
          font-weight: 400;
          src: url('/fonts/Roboto-Regular.ttf') format('truetype');
        }
        @font-face {
          font-family: 'Roboto';
          font-style: italic;
          font-weight: 400;
          src: url('/fonts/Roboto-Italic.ttf') format('truetype');
        }
        @font-face {
          font-family: 'Roboto';
          font-style: normal;
          font-weight: 700;
          src: url('/fonts/Roboto-Bold.ttf') format('truetype');
        }
        @font-face {
          font-family: 'Roboto';
          font-style: italic;
          font-weight: 700;
          src: url('/fonts/Roboto-BoldItalic.ttf') format('truetype');
        }
        @font-face {
          font-family: 'Roboto';
          font-style: normal;
          font-weight: 300;
          src: url('/fonts/Roboto-Light.ttf') format('truetype');
        }
         @font-face {
          font-family: 'Roboto';
          font-style: italic;
          font-weight: 300;
          src: url('/fonts/Roboto-LightItalic.ttf') format('truetype');
        }

        body { font-family: 'Roboto', sans-serif; line-height: 1.6; margin: 40px; }
        h1 { text-align: center; margin-bottom: 10px; font-weight: 700; } /* Usar bold */
        h2 { margin-top: 40px; border-bottom: 1px solid #eee; padding-bottom: 5px; page-break-before: always; font-weight: 700; } /* Usar bold */
        /* Evitar quebra antes do H2 da primeira página de conteúdo real */
        .content-start h2:first-of-type { page-break-before: avoid; }
        p.description { font-style: italic; margin-bottom: 20px; text-align: center; }
        .page-content { margin-top: 15px; white-space: pre-wrap; } /* Preserve line breaks */
        .warning { color: #888; font-style: italic; margin-top: 50px; border-top: 1px solid #ccc; padding-top: 10px; }
        
        /* Estilos da Capa */
        .cover-page {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          min-height: 80vh; /* Ocupar maior parte da página */
          text-align: center;
          page-break-after: always; /* Quebrar página após a capa */
          border: none; /* Remover borda do H1 padrão */
        }
        .cover-page h1 {
          font-size: 2.5em;
          border-bottom: none;
          margin-bottom: 20px;
          font-weight: 700;
        }
        .cover-page .description {
          font-size: 1.1em;
          max-width: 80%;
          font-style: italic;
        }

        /* Estilos do Sumário */
        .toc-page {
          page-break-after: always; /* Quebrar página após o sumário */
        }
        .toc-page h2 {
          text-align: center;
          page-break-before: avoid; /* Não quebrar antes do título do sumário */
          margin-bottom: 20px;
          border-bottom: 1px solid #ccc;
          font-weight: 700;
        }
        .toc-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .toc-list li {
          margin-bottom: 8px;
        }
      </style>
    </head>
    <body>
      <!-- Página de Capa -->
      <div class="cover-page">
        <h1>${state.title}</h1> {/* Corrigido: Título dentro do H1 */}
        <p class="description">${state.description}</p>
      </div>

      <!-- Página de Sumário -->
      <div class="toc-page">
        <h2>Sumário</h2>
        <ul class="toc-list">
          ${pages.map((page, index) => `<li><a href="#page-${page.pageIndex}">${page.pageTitle}</a></li>`).join('')}
        </ul>
      </div>

      <!-- Conteúdo do Ebook -->
      <div class="content-start">
        ${pages.map((page, index) => `
          <h2 id="page-${page.pageIndex}">${page.pageTitle}</h2>
          <div class="page-content">${formatContent(page.content)}</div>
        `).join('')}
      </div>
  `;

  // Aviso de ebook incompleto (colocado no final do corpo HTML)
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
  context: any // Usando 'any' explicitamente
) {
  let ebookId: string | undefined;
  let browser: Browser | null = null;

  // Verificar manualmente a estrutura esperada devido ao uso de 'any'
  if (context && context.params && typeof context.params.ebookId === 'string') {
    ebookId = context.params.ebookId;
  } else {
    console.error("Contexto inválido ou ebookId não encontrado:", context);
    return NextResponse.json({ success: false, error: "Invalid request context or missing ebookId" }, { status: 400 });
  }

  if (!ebookId) { // Verificação de segurança
    return NextResponse.json({ success: false, error: "Ebook ID is required" }, { status: 400 });
  }

  // Manter apenas o try...catch original para a lógica do Puppeteer
  try {
    // Obter o estado e as páginas do ebook
    const [ebookState, pagesData] = await Promise.all([
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

    // Verificar se pagesData é um array válido (Renomeado para evitar conflito)
     if (!Array.isArray(pagesData)) {
          console.error("Erro: getEbookPages não retornou um array:", pagesData);
          return NextResponse.json({ success: false, error: "Failed to retrieve ebook pages." }, { status: 500 });
     }

    // Filtrar e ordenar as páginas completas (Usando pagesData)
    const completedPages = pagesData
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
      headless: true, // Usar true para resolver o erro de tipo
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Gerar o PDF
    console.log("Gerando buffer PDF...");
    const pdfBuffer = await page.pdf({
      format: 'a4', // Usar minúsculas
      printBackground: true,
      margin: {
        top: '50px',
        right: '50px',
        bottom: '60px', // Aumentar margem inferior para o rodapé
        left: '50px',
      },
      displayHeaderFooter: true, // Habilitar cabeçalho/rodapé
      footerTemplate: `
        <div style="font-family: 'Roboto', sans-serif; font-size: 9px; text-align: center; width: 100%; color: #888; padding-bottom: 10px;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `, // Template do rodapé com número de página
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
