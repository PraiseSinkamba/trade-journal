"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
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
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/** Show rich hover/focus help on the caller's element without adding a DOM wrapper. */
function HoverHint({
  children,
  heading,
  content,
  align,
  side = "top",
  delay: delayDuration,
}: {
  children: React.ReactElement<{
    children?: React.ReactNode;
    "aria-describedby"?: string;
  }>;
  heading?: string;
  content?: React.ReactNode | null;
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  delay?: number;
}) {
  const descriptionId = React.useId();
  if (content === null || (heading === undefined && content === undefined)) return children;

  // Compose the element directly so Base UI merges its ref/events without changing link/button semantics.
  const trigger = React.cloneElement(children, {
    "aria-describedby": [children.props["aria-describedby"], descriptionId]
      .filter(Boolean)
      .join(" "),
  });
  return (
    <HoverCard>
      <HoverCardTrigger render={trigger} delay={delayDuration ?? 350} closeDelay={150} />
      <HoverCardContent
        id={descriptionId}
        role="tooltip"
        align={align}
        side={side}
        className="flex flex-col gap-1"
      >
        {heading && <div className="font-semibold leading-none">{heading}</div>}
        {content !== undefined && (
          <div className="text-muted-foreground text-pretty text-sm leading-snug">{content}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// HelpHint: icon-trigger rich popover using CircleHelp.
// Built on top of the shadcn HoverCard primitives for richer styling
// (card-style heading + body, larger padding, shadow, ring).
// `children` is the body content; the trigger is always the icon button.
function HelpHint({
  children,
  heading,
  content,
  align,
  side,
  delay: delayDuration,
}: {
  children?: React.ReactNode;
  heading?: string;
  content?: React.ReactNode | null;
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  delay?: number;
}) {
  const descriptionId = React.useId();
  const body = content ?? children;
  if (heading === undefined && (body === undefined || body === null)) return null;
  return (
    <HoverCard>
      <HoverCardTrigger
        render={<button type="button" />}
        delay={delayDuration ?? 350}
        closeDelay={150}
        aria-label={heading ? `About ${heading}` : "More information"}
        aria-describedby={descriptionId}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
      </HoverCardTrigger>
      <HoverCardContent
        id={descriptionId}
        role="tooltip"
        align={align}
        side={side}
        className="flex flex-col gap-1"
      >
        {heading && <div className="font-semibold leading-none">{heading}</div>}
        {body && (
          <div className="text-muted-foreground text-pretty text-sm leading-snug">{body}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, HoverHint, HelpHint };
