"use client";
import { Checkbox } from "./ui/checkbox";
import { HelpHint } from "./ui/tooltip";
import { Label } from "./ui/label";
import { AI_IMPORT_HELP } from "@/lib/ai-import";
import { type AiProvider } from "@/lib/ai-settings";

/**
 * Minimal AI-preview toggle. Provider, model, and key are resolved on the
 * server; this control only carries the boolean intent. The browser never
 * sees API keys, model IDs, or provider IDs.
 */
export function AiImportToggle({
  enabled,
  onEnabledChange,
  provider,
  disabled,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  provider: AiProvider;
  disabled: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Checkbox
        id="ai-import-enabled"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(checked) => onEnabledChange(checked === true)}
      />
      <Label
        htmlFor="ai-import-enabled"
        className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-muted-foreground"
      >
        Parse with AI ({provider})
      </Label>
      <HelpHint heading="AI statement parsing">{AI_IMPORT_HELP}</HelpHint>
    </div>
  );
}
