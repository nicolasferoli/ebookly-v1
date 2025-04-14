# Gerador de Ebook com IA (geradordeebookkvn)

Este é um projeto Next.js que permite gerar ebooks sobre um determinado tópico usando inteligência artificial (OpenAI GPT-4o) e gerenciar o processo de forma assíncrona com uma fila baseada no Vercel KV (Redis).

## Funcionalidades

*   **Geração de Sumário por IA:** Cria uma estrutura de capítulos e páginas (sumário) coesa e relevante para o título e descrição fornecidos.
*   **Geração de Conteúdo por IA:** Gera o conteúdo de cada página do ebook com base no título da página e no contexto geral do ebook.
*   **Modos de Conteúdo:** Permite escolher diferentes níveis de detalhamento para o conteúdo gerado (Completo, Médio, Mínimo, Ultra-mínimo).
*   **Processamento Assíncrono:** Utiliza o Vercel KV (compatível com Redis) para enfileirar as tarefas de geração de página.
*   **Worker via Cron Job:** Um endpoint da API (`/api/worker`), acionado por um Vercel Cron Job, processa a fila de geração de páginas continuamente.
*   **Visualização de Progresso:** A interface exibe o status atual da geração, páginas concluídas, estimativa de tempo restante e permite visualizar o conteúdo das páginas geradas.
*   **Download do Ebook:** Permite baixar o ebook completo (ou parcial) como um arquivo de texto (`.txt`) quando a geração estiver concluída.
*   **(Futuro/Potencial):** Funcionalidade de "Biblioteca" para salvar e gerenciar ebooks gerados (endpoints da API existem, mas a funcionalidade completa pode precisar de implementação adicional).

## Tecnologias Utilizadas

*   **Framework:** [Next.js](https://nextjs.org/) (React)
*   **Linguagem:** [TypeScript](https://www.typescriptlang.org/)
*   **Estilização:** [Tailwind CSS](https://tailwindcss.com/)
*   **Componentes UI:** [Shadcn/UI](https://ui.shadcn.com/)
*   **IA:** [OpenAI GPT-4o](https://openai.com/gpt-4o/) via [Vercel AI SDK](https://sdk.vercel.ai/)
*   **Fila & Cache:** [Vercel KV](https://vercel.com/storage/kv) (Upstash Redis)
*   **Tarefas Agendadas:** [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
*   **Gerenciador de Pacotes:** [pnpm](https://pnpm.io/)

## Como Executar Localmente

1.  **Clonar o Repositório:**
    ```bash
    git clone https://github.com/nicolasferoli/geradordeebookkvn.git
    cd geradordeebookkvn
    ```

2.  **Instalar Dependências:**
    ```bash
    pnpm install
    ```

3.  **Configurar Variáveis de Ambiente:**
    *   Crie um arquivo `.env.local` na raiz do projeto.
    *   Adicione as seguintes variáveis (substitua pelos seus valores):
        ```env
        # Chave da API da OpenAI
        OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

        # URLs e Token do Vercel KV (ou Upstash Redis)
        # Obtidos ao criar um banco de dados KV na Vercel
        KV_URL=rediss://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        KV_REST_API_URL=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        KV_REST_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        ```

4.  **Rodar o Servidor de Desenvolvimento:**
    ```bash
    pnpm dev
    ```
    Abra [http://localhost:3000](http://localhost:3000) no seu navegador.

5.  **Processar a Fila (Desenvolvimento):**
    *   Como o Cron Job não roda localmente por padrão, você precisará acionar manualmente o endpoint do worker para processar a fila enquanto o servidor de desenvolvimento está rodando.
    *   Abra uma nova aba no navegador ou use `curl` para acessar: `http://localhost:3000/api/worker?count=5` (ou `http://localhost:3000/api/start-worker?count=5`).
    *   Você precisará fazer isso repetidamente para que a geração progrida.

## Estrutura do Projeto

```
.
├── app/                      # Diretório principal do Next.js App Router
│   ├── api/                  # Rotas da API (ebook, worker, redis check, etc.)
│   ├── biblioteca/           # (Potencial) Rota para a biblioteca de ebooks
│   ├── (outras rotas...)/
│   ├── globals.css           # Estilos globais
│   ├── layout.tsx            # Layout principal da aplicação
│   └── page.tsx              # Página principal (interface do gerador)
├── components/               # Componentes React reutilizáveis
│   └── ui/                   # Componentes Shadcn/UI
├── hooks/                    # Hooks React customizados
├── lib/                      # Lógica principal e utilitários
│   ├── ebook-generator.ts    # Lógica de geração de conteúdo e sumário com IA
│   ├── redis.ts              # Interação com Vercel KV/Redis (fila, estado)
│   └── utils.ts              # Funções utilitárias gerais
├── public/                   # Arquivos estáticos
├── styles/                   # Arquivos de estilo adicionais
├── .env.local                # (Não commitado) Variáveis de ambiente locais
├── .gitignore                # Arquivos ignorados pelo Git
├── next.config.mjs           # Configuração do Next.js
├── package.json              # Dependências e scripts do projeto
├── pnpm-lock.yaml            # Lockfile do pnpm
├── postcss.config.mjs        # Configuração do PostCSS
├── tailwind.config.ts        # Configuração do Tailwind CSS
├── tsconfig.json             # Configuração do TypeScript
└── vercel.json               # Configuração da Vercel (incluindo Cron Jobs)
```

## Variáveis de Ambiente Necessárias

*   `OPENAI_API_KEY`: Sua chave secreta da API da OpenAI.
*   `KV_REST_API_URL`: URL da API REST do seu banco de dados Vercel KV.
*   `KV_REST_API_TOKEN`: Token de acesso ao seu banco de dados Vercel KV.
*   `KV_URL`: (Opcional, pode ser usado como fallback) URL de conexão direta do Redis.

---

Readme gerado com auxílio de IA.
