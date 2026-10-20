"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "@/lib/utils"
import { CircleHelp } from "lucide-react"

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={12}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "journal-hover-card z-[80] max-w-[min(19rem,calc(100vw-24px))] rounded-xl border bg-popover p-3.5 text-[13px] leading-relaxed text-popover-foreground",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

// Project extensions.
export function HoverHint({
  children,
  content,
  heading,
  side = "top",
  align = "center",
  delayDuration,
  skipDelayDuration,
}: HoverHintProps) {
  if (content === null) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger delay={delayDuration ?? 350} closeDelay={skipDelayDuration ?? 150}>
        {children}
      </TooltipTrigger>
      <TooltipContent align={align} side={side}>
        {heading && (
          <div className="mb-1 text-[13px] font-semibold text-popover-foreground">{heading}</div>
        )}
        <div className={heading ? "text-muted-foreground" : undefined}>{content}</div>
      </TooltipContent>
    </Tooltip>
  )
}

export function HelpHint({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <HoverHint heading={heading} content={children}>
      <button
        type="button"
        aria-label={`About ${heading}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </HoverHint>
  )
}

export type HoverHintProps = {
  children: React.ReactElement
  content: React.ReactNode
  heading?: string
  align?: "center" | "start" | "end"
  side?: "top" | "right" | "bottom" | "left" | "inline-end" | "inline-start"
  sideOffset?: number
  delayDuration?: number
  skipDelayDuration?: number
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
