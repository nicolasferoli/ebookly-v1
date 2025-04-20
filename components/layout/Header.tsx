import React from 'react';
import Link from 'next/link';
import { BookOpen, Library } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:left-64">
      <div className="container flex h-full max-w-screen-2xl items-center justify-between px-4 md:px-6">
        {/* Link para a Home (opcional, pode ser só texto) */}
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg">
          <BookOpen className="h-6 w-6 text-primary" />
          <span>Ebookly</span>
        </Link>
        
        {/* Links de Navegação (à direita) */}
        <nav className="flex items-center gap-4">
          <Link 
            href="/biblioteca" 
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "flex items-center gap-1"
            )}
          >
            <Library className="h-4 w-4" />
            Biblioteca
          </Link>
          {/* Espaço para outros links ou botões, como o tema toggle, se fosse adicionado */}
        </nav>
      </div>
    </header>
  );
} 