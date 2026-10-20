"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger

// DialogClose added (was missing in original, now exported from registry)
const DialogClose = DialogPrimitive.Close

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          // ponytail: original journal-popup journal-dialog journal-menu-surface classes (harmless no-ops)
          "journal-popup fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-24px)] min-w-0 max-w-lg max-h-[calc(100dvh-24px)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-xl border bg-card p-4 shadow-lg sm:p-6",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus-visible:outline focus-visible:outline-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col space-y-1.5", className)} {...props} />
}

// ponytail: original had small/uppercase title (matching CardTitle) — restored
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground pr-6",
        className,
      )}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

// DialogFooter added (was missing in original, now exported from registry)
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
