"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface StudioButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  loading?: boolean;
}

export function StudioButton({ children, loading, className, disabled, ...props }: StudioButtonProps) {
  return (
    <Button
      disabled={disabled || loading}
      className={cn("group relative overflow-hidden transition-all duration-300", className)}
      size="lg"
      {...props}
    >
      {/* Label section: fades out on hover to reveal the icon overlay, OR shows loading */}
      <span className={cn(
        "flex items-center gap-2 transition-all duration-500",
        !loading && "group-hover:opacity-0 mr-8"
      )}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </span>

      {/* The slide-in overlay with the icon */}
      {!loading && (
        <i className="absolute right-1 top-1 bottom-1 rounded-sm z-10 grid w-1/4 place-items-center transition-all duration-500 bg-white/20 group-hover:w-[calc(100%-0.5rem)] group-active:scale-95 text-white">
          <ChevronRight size={18} strokeWidth={2.5} aria-hidden="true" />
        </i>
      )}
    </Button>
  );
}
