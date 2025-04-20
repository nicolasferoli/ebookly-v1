"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { BookText, Download, AlertCircle, ArrowRight, Database, RefreshCw, Library, Play, Sparkles, Settings, FileText, Eye } from "lucide-react"
import { getContentModes, getCurrentContentMode } from "@/lib/ebook-generator"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { EbookQueueState } from "@/lib/redis"
import { StepIndicator } from "@/components/step-indicator"
import { GenerationStatus } from "@/components/generation-status"
import { PageViewer } from "@/components/page-viewer"
import { SimpleLoading } from "@/components/simple-loading"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from 'next/navigation'
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Controller } from "react-hook-form"
import { z } from "zod"
import { Progress } from "@/components/ui/progress"

// Tempo médio estimado por página em segundos (varia conforme o modo de conteúdo)
const ESTIMATED_TIME_PER_PAGE = {
  FULL: 30,
  MEDIUM: 20,
  MINIMAL: 15,
  ULTRA_MINIMAL: 10,
}

// Intervalo de atualização do status (em ms)
const STATUS_UPDATE_INTERVAL = 3000

// Opções de quantidade de páginas
const PAGE_COUNT_OPTIONS = [5, 10, 15, 20, 30, 40, 50]

// Passos do processo
const STEPS = ["Nome", "Configuração", "Geração", "Conclusão"]

const MAX_CHARS = 10000

const ebookSchema = z.object({
  prompt: z.string().min(10, "O prompt precisa ter pelo menos 10 caracteres.").max(MAX_CHARS, `O prompt não pode exceder ${MAX_CHARS} caracteres.`),
  author: z.string().min(2, "O nome do autor precisa ter pelo menos 2 caracteres.").max(100, "O nome do autor não pode exceder 100 caracteres."),
  title: z.string().min(3, "O título precisa ter pelo menos 3 caracteres.").max(150, "O título não pode exceder 150 caracteres."),
  targetAudience: z.string().min(5, "O público alvo precisa ter pelo menos 5 caracteres.").max(200, "O público alvo não pode exceder 200 caracteres."),
  writingStyle: z.string().min(5, "O estilo de escrita precisa ter pelo menos 5 caracteres.").max(150, "O estilo de escrita não pode exceder 150 caracteres."),
})

type EbookFormData = z.infer<typeof ebookSchema>

type GenerationStatus = "idle" | "generating" | "success" | "error"
type Stage = "prompt" | "details" | "generating" | "result"

export default function EbookGenerator() {
  const [status, setStatus] = useState<GenerationStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [generatedEbookId, setGeneratedEbookId] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>("prompt")
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const router = useRouter()

  const {
    register: registerFormField,
    handleSubmit,
    control,
    watch,
    formState: { errors, isValid: isFormValid, dirtyFields },
    trigger,
    getValues,
    reset,
  } = useForm<EbookFormData>({
    resolver: zodResolver(ebookSchema),
    mode: "onChange",
    defaultValues: {
      prompt: "",
      author: "",
      title: "",
      targetAudience: "Leitores interessados no tópico [Tópico Principal]",
      writingStyle: "Informativo e acessível",
    },
  })

  const wsRef = useRef<WebSocket | null>(null)

  const handleWebSocket = useCallback((ebookId: string) => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`

    console.log("Connecting WebSocket to:", wsUrl)
    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = () => {
      console.log("WebSocket Connected")
      wsRef.current?.send(JSON.stringify({ type: 'register', ebookId }))
      setProgress(5)
    }

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log("WebSocket Message Received:", message)
        if (message.ebookId !== ebookId) return

        if (message.type === "progress") {
          setProgress(message.progress)
          setCurrentPage(message.currentPage || 1)
          setTotalPages(message.totalPages || 0)
        } else if (message.type === "complete") {
          setStatus("success")
          setProgress(100)
          setGeneratedEbookId(ebookId)
          wsRef.current?.close()
        } else if (message.type === "error") {
          setStatus("error")
          setErrorMsg(message.error || "Ocorreu um erro desconhecido.")
          setProgress(0)
          wsRef.current?.close()
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message or handle update:", e)
        setErrorMsg("Erro ao processar atualização de status.")
        setStatus("error")
      }
    }

    wsRef.current.onerror = (error) => {
      console.error("WebSocket Error:", error)
      setErrorMsg("Erro na conexão de status em tempo real.")
      setStatus("error")
      setProgress(0)
    }

    wsRef.current.onclose = (event) => {
      console.log("WebSocket Disconnected:", event.reason, event.code)
      wsRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const onSubmit = async (data: EbookFormData) => {
    console.log("Form Data Submitted:", data)
    setStatus("generating")
    setStage("generating")
    setProgress(0)
    setErrorMsg(null)
    setGeneratedEbookId(null)

    try {
      const response = await fetch("/api/ebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        console.error("API Error Response:", result)
        throw new Error(result.error || `Falha na geração do ebook: ${response.statusText}`)
      }

      const ebookId = result.ebookId
      if (!ebookId) {
        throw new Error("ID do Ebook não recebido do servidor.")
      }

      console.log("Ebook generation started successfully, Ebook ID:", ebookId)
      setGeneratedEbookId(ebookId)
      handleWebSocket(ebookId)

    } catch (error: any) {
      console.error("Error starting ebook generation:", error)
      setStatus("error")
      setErrorMsg(error.message || "Ocorreu uma falha ao iniciar a geração do ebook.")
      setProgress(0)
      setStage("prompt")
    }
  }

  const handleNext = async () => {
    const result = await trigger(["prompt"])
    if (result) {
      setStage("details")
    }
  }

  const handleBack = () => {
    setStage("prompt")
  }

  const handleReset = () => {
    reset()
    setStatus("idle")
    setProgress(0)
    setErrorMsg(null)
    setGeneratedEbookId(null)
    setStage("prompt")
    wsRef.current?.close()
  }

  const steps = ["Ideia Principal", "Detalhes", "Gerando", "Resultado"]
  const currentStepIndex = stage === "prompt" ? 0 : stage === "details" ? 1 : stage === "generating" ? 2 : 3

  const isPromptFilled = !!getValues("prompt") && !errors.prompt
  const areDetailsValid = isFormValid && stage === 'details'

  const renderStage = () => {
    switch (stage) {
      case "prompt":
        return (
          <motion.div
            key="prompt"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ duration: 0.3 }}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Sparkles className="w-5 h-5 text-purple-500" /> Qual a sua ideia para o Ebook?
              </CardTitle>
              <CardDescription>
                Descreva o tema central, os tópicos principais ou a pergunta que seu ebook irá responder. Seja o mais claro possível!
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Controller
                name="prompt"
                control={control}
                render={({ field }) => (
                  <FloatingLabelTextarea
                    id="prompt"
                    label="Ideia central do Ebook"
                    placeholder="Ex: Um guia completo sobre jardinagem para iniciantes em apartamentos."
                    error={errors.prompt}
                    register={field}
                    value={field.value}
                    getValues={getValues}
                    maxLength={MAX_CHARS}
                  />
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end">
              <ButtonColorful onClick={handleNext} disabled={!isPromptFilled}>
                Avançar para Detalhes <Settings className="ml-2 h-4 w-4" />
              </ButtonColorful>
            </CardFooter>
          </motion.div>
        )
      case "details":
        return (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Settings className="w-5 h-5 text-indigo-500" /> Detalhes do Ebook
              </CardTitle>
              <CardDescription>
                Refine as informações para personalizar a geração.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              <FloatingLabelInput
                id="title"
                label="Título do Ebook"
                placeholder="Ex: Jardim Secreto na Varanda"
                error={errors.title}
                register={registerFormField("title")}
                defaultValue={getValues("title")}
              />
              <FloatingLabelInput
                id="author"
                label="Nome do Autor"
                placeholder="Ex: Maria Silva"
                error={errors.author}
                register={registerFormField("author")}
                defaultValue={getValues("author")}
              />
              <FloatingLabelInput
                id="targetAudience"
                label="Público Alvo"
                placeholder="Ex: Moradores de apartamento sem experiência prévia"
                error={errors.targetAudience}
                register={registerFormField("targetAudience")}
                defaultValue={getValues("targetAudience")}
              />
              <FloatingLabelInput
                id="writingStyle"
                label="Estilo de Escrita"
                placeholder="Ex: Amigável, passo a passo, com dicas práticas"
                error={errors.writingStyle}
                register={registerFormField("writingStyle")}
                defaultValue={getValues("writingStyle")}
              />
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={handleBack}>
                Voltar
              </Button>
              <ButtonColorful type="submit" disabled={status === "generating" || !areDetailsValid}>
                Gerar Ebook <Sparkles className="ml-2 h-4 w-4" />
              </ButtonColorful>
            </CardFooter>
          </motion.div>
        )
      case "generating":
        return (
          <motion.div
            key="generating"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center py-12 px-6"
          >
            <Progress value={progress} className="w-full max-w-md mx-auto mb-4 h-3 [&>*]:bg-gradient-to-r [&>*]:from-indigo-500 [&>*]:via-purple-500 [&>*]:to-pink-500" />
            <h3 className="text-2xl font-semibold mb-3">Gerando seu Ebook...</h3>
            <p className="text-muted-foreground mb-6">
              Isso pode levar alguns minutos. Estamos criando o conteúdo para você.
            </p>
            <p className="text-sm text-muted-foreground">
              {progress}% concluído
              {totalPages > 0 && ` - Página ${currentPage} de ${totalPages}`}
            </p>
          </motion.div>
        )
      case "result":
        return (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center py-12 px-6"
          >
            {status === "success" && generatedEbookId && (
              <>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1}} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
                  <FileText className="h-16 w-16 text-green-500 mx-auto mb-6" />
                </motion.div>
                <h3 className="text-2xl font-semibold mb-3">Ebook Gerado com Sucesso!</h3>
                <p className="text-muted-foreground mb-8">
                  Seu ebook "{getValues("title") || 'sem título'}" está pronto.
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-4">
                  <ButtonColorful
                    onClick={() => window.location.href = `/api/ebook/${generatedEbookId}/download`}
                  >
                    <Download className="mr-2 h-4 w-4" /> Baixar PDF
                  </ButtonColorful>
                  <Button
                    variant="outline"
                    onClick={() => window.open(`/ebook/${generatedEbookId}/view`, '_blank')}
                  >
                    <Eye className="mr-2 h-4 w-4" /> Visualizar Online
                  </Button>
                  <Button variant="secondary" onClick={handleReset}>
                    <Sparkles className="mr-2 h-4 w-4" /> Criar Novo Ebook
                  </Button>
                </div>
              </>
            )}
            {status === "error" && (
              <>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1}} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
                  <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-6" />
                </motion.div>
                <h3 className="text-2xl font-semibold text-destructive mb-3">Ocorreu um Erro!</h3>
                <Alert variant="destructive" className="max-w-md mx-auto mb-8 text-left">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Erro na Geração</AlertTitle>
                  <AlertDescription>
                    {errorMsg || "Não foi possível gerar o ebook. Tente novamente mais tarde ou ajuste o prompt."}
                  </AlertDescription>
                </Alert>
                <Button variant="outline" onClick={handleReset}>
                  Tentar Novamente
                </Button>
              </>
            )}
          </motion.div>
        )
    }
  }

  useEffect(() => {
    if (status === 'success' || status === 'error') {
      setStage('result')
    } else if (status === 'generating') {
      setStage('generating')
    }
  }, [status])

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
      <header className="mb-8 md:mb-12 text-center">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-transparent bg-clip-text">
          Ebookly ⚡️ Generator
        </h1>
        <p className="text-muted-foreground text-lg">
          Transforme suas ideias em ebooks completos com o poder da IA.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 text-sm text-primary hover:text-primary/90"
          onClick={() => router.push('/biblioteca')}
        >
          <Library className="mr-2 h-4 w-4" />
          Ver minha Biblioteca
        </Button>
      </header>

      <Card className="w-full shadow-xl border border-border/40 rounded-xl overflow-hidden bg-card">
        {(stage !== 'result') && (
          <div className="px-6 pt-6 border-b border-border/20 pb-6">
            <StepIndicator steps={steps} currentStep={currentStepIndex + 1} />
          </div>
        )}

        {status === "error" && stage !== 'result' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-6 py-4 border-b border-destructive/30 bg-destructive/10"
          >
            <Alert variant="destructive" className="bg-transparent border-none p-0">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro na Geração</AlertTitle>
              <AlertDescription>
                {errorMsg || "Não foi possível gerar o ebook."}
                {' '} <Button variant="link" onClick={handleReset} className="p-0 h-auto text-destructive font-semibold underline">Tentar Novamente</Button>
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        <div className={cn("transition-all duration-300", stage !== 'generating' && stage !== 'result' ? 'p-6' : '')}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <AnimatePresence mode="wait">
              {renderStage()}
            </AnimatePresence>
          </form>
        </div>
      </Card>

      <footer className="text-center mt-12 text-sm text-muted-foreground">
        Powered by AI Magic ✨
      </footer>
    </div>
  )
}

// Custom Button Component with gradient effect
interface ButtonColorfulProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

function ButtonColorful({
  className,
  children,
  ...props
}: ButtonColorfulProps) {
  return (
    <Button
      className={cn(
        "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:opacity-90 transition-opacity duration-300 shadow-md focus:ring-2 focus:ring-offset-2 focus:ring-purple-500",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

// Floating Label Input Component
function FloatingLabelInput({ label, id, error, register, ...props }: any) {
  const [isFocused, setIsFocused] = useState(false);
  const [hasValue, setHasValue] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFocus = () => setIsFocused(true);
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    setHasValue(e.target.value !== '');
  };

  // Check initial value on mount
  useEffect(() => {
    if (inputRef.current?.value) {
      setHasValue(true);
    }
    // Also check if there's a defaultValue passed via props (from react-hook-form)
    else if (props.defaultValue) {
      setHasValue(true);
    }
  }, [props.defaultValue]);

  return (
    <div className="relative pt-4">
      <motion.label
        htmlFor={id}
        className={cn(
          "absolute left-3 transition-all duration-200 ease-in-out pointer-events-none bg-background px-1",
          (isFocused || hasValue) ? "-top-2 text-xs text-primary" : "top-[1.125rem] text-sm text-muted-foreground"
        )}
        initial={false}
        animate={{
          top: (isFocused || hasValue) ? -8 : 18,
          fontSize: (isFocused || hasValue) ? '0.75rem' : '0.875rem',
          color: (isFocused || hasValue) ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'
        }}
        transition={{ duration: 0.2 }}
      >
        {label}
      </motion.label>
      <Input
        id={id}
        ref={inputRef}
        className={cn("peer h-10 pt-3", error ? "border-destructive" : "")}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => {
          setHasValue(e.target.value !== '');
          if (register) {
            register.onChange(e);
          }
        }}
        {...register}
        {...props}
      />
      {error && <p className="text-xs text-destructive mt-1">{error.message}</p>}
    </div>
  );
}

// Floating Label Textarea Component
function FloatingLabelTextarea({ label, id, error, register, getValues, ...props }: any) {
  const [isFocused, setIsFocused] = useState(false);
  const [hasValue, setHasValue] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFocus = () => setIsFocused(true);
  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(false);
    setHasValue(e.target.value !== '');
  };

  // Check initial value on mount
  useEffect(() => {
    if (textareaRef.current?.value) {
      setHasValue(true);
    }
    // Also check if there's a defaultValue passed via props (from react-hook-form)
    else if (props.defaultValue) {
      setHasValue(true);
    }
  }, [props.defaultValue]);

  return (
    <div className="relative pt-4">
      <motion.label
        htmlFor={id}
        className={cn(
          "absolute left-3 transition-all duration-200 ease-in-out pointer-events-none bg-background px-1",
          (isFocused || hasValue) ? "-top-2 text-xs text-primary" : "top-2.5 text-sm text-muted-foreground"
        )}
        initial={false}
        animate={{
          top: (isFocused || hasValue) ? -8 : 10,
          fontSize: (isFocused || hasValue) ? '0.75rem' : '0.875rem',
          color: (isFocused || hasValue) ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'
        }}
        transition={{ duration: 0.2 }}
      >
        {label}
      </motion.label>
      <Textarea
        id={id}
        ref={textareaRef}
        className={cn("peer resize-none min-h-[120px] pt-3", error ? "border-destructive" : "")}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => {
          setHasValue(e.target.value !== '');
          if (register) {
            register.onChange(e);
          }
        }}
        {...register}
        {...props}
      />
      {error && <p className="text-xs text-destructive mt-1">{error.message}</p>}
      <p className="text-xs text-muted-foreground mt-1 text-right">
        {(props.value?.length !== undefined ? props.value.length : (register?.name && getValues ? getValues(register.name)?.length : 0)) || 0}/{MAX_CHARS}
      </p>
    </div>
  );
}
