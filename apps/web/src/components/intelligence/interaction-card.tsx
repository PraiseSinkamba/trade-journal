"use client";

import { useState } from "react";
import { MonetaryValue } from "@/components/privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  commandRequestBody,
  dismissalRequestBody,
  type IntentActionDescriptor,
  type InteractionIntent,
  type ObservationSummary,
  type OpportunitySummary,
} from "@/lib/intelligence-interactions";
import { ApiError, postJson } from "@/lib/use-api";
import { cn, fmtMoney } from "@/lib/utils";

/**
 * One interaction the server offered.
 *
 * The card renders what the server authorised and nothing else: the action
 * ids, the labels and the revision all come from the intent, and the client
 * assembles no handle of its own. The composed `intent.text` of an
 * observation review is deliberately not rendered: it carries the net P&L in
 * plain characters, which the privacy overlay cannot mask, so the structured
 * facts are rendered instead.
 */

/** The money of one observation, in the currency the observation carries. */
const money = (value: number, currency: string): string => {
  try {
    return fmtMoney(value, currency);
  } catch {
    // An unknown currency code must not take the card down.
    return `${value} ${currency}`;
  }
};

/** The idempotency key of one command: the client mints it, the server dedupes on it. */
const newCommandId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The chip the trade status reads as: text carries the state, colour reinforces it. */
const tradeChip = (status: string) => {
  if (status === "win") return { label: "WIN", variant: "profit" as const };
  if (status === "loss") return { label: "LOSS", variant: "loss" as const };
  if (status === "open") return { label: "OPEN", variant: "secondary" as const };
  return { label: "BREAKEVEN", variant: "outline" as const };
};

/** The structured facts of one observation: what the journal saw, in numbers. */
export function ObservationFacts({ observation }: { observation: ObservationSummary }) {
  const chip = tradeChip(observation.tradeStatus);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Trade</dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        <Badge variant={chip.variant}>{chip.label}</Badge>
        <span className="font-mono break-all">{observation.subjectId}</span>
      </dd>
      <dt className="text-muted-foreground">Net P&amp;L</dt>
      <dd className="tnum">
        <MonetaryValue>{money(observation.netPnl, observation.currency)}</MonetaryValue>
      </dd>
      <dt className="text-muted-foreground">Fees</dt>
      <dd className="tnum">
        <MonetaryValue>{money(observation.fees, observation.currency)}</MonetaryValue>
      </dd>
      <dt className="text-muted-foreground">Timing</dt>
      <dd>{observation.timingQuality}</dd>
    </dl>
  );
}

/** One interaction and the actions the server authorised on it. */
export function InteractionCard({
  intent,
  observation,
  opportunity,
  onChanged,
}: {
  readonly intent: InteractionIntent;
  readonly observation?: ObservationSummary;
  readonly opportunity?: OpportunitySummary;
  /**
   * Called after the operator acted.
   *
   * `applied` is false when the server refused the action as stale: the
   * caller still refreshes, but the action did not take effect.
   */
  readonly onChanged?: (applied: boolean) => void;
}) {
  const [answering, setAnswering] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [deferUntil, setDeferUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const evidence =
    intent.kind === "observation-review"
      ? intent.evidence.map((reference) => ({ id: reference.revisionId, kind: reference.kind }))
      : (opportunity?.evidenceIds ?? []).map((id) => ({ id, kind: "evidence revision" }));

  const run = async (
    descriptor: IntentActionDescriptor,
    extra?: { correction?: string; deferUntil?: number },
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      if (descriptor.action === "dismiss") {
        const body = dismissalRequestBody(descriptor.actionId);
        if (!body) throw new Error("That action is no longer valid.");
        await postJson("/api/intelligence/opportunities", body);
      } else {
        const body = commandRequestBody(intent, descriptor, {
          commandId: newCommandId(),
          ...extra,
        });
        if (!body) throw new Error("That action is no longer valid.");
        await postJson("/api/intelligence/commands", body);
      }
      setAnswering(null);
      setCorrection("");
      setDeferUntil("");
      onChanged?.(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        // The workflow moved on: the list is refreshed and the action is not
        // retried blindly, because the revision it carried is stale.
        setNotice({ tone: "info", text: "This interaction changed" });
        onChanged?.(false);
        return;
      }
      setNotice({
        tone: "error",
        text: cause instanceof Error ? cause.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitCorrection = () => {
    const text = correction.trim();
    if (!text) {
      setNotice({ tone: "error", text: "Write what the review should say." });
      return;
    }
    const descriptor = intent.actions.find((action) => action.action === "correct");
    if (!descriptor) return;
    void run(descriptor, { correction: text });
  };

  const submitDeferral = () => {
    const instant = Date.parse(deferUntil);
    if (!deferUntil || Number.isNaN(instant)) {
      setNotice({ tone: "error", text: "Choose when to come back to this." });
      return;
    }
    const descriptor = intent.actions.find((action) => action.action === "defer");
    if (!descriptor) return;
    void run(descriptor, { deferUntil: instant });
  };

  const title =
    intent.kind === "observation-review"
      ? "Observation review"
      : intent.kind === "input-request"
        ? "The journal has a question"
        : "Journal insight";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {observation ? (
          <ObservationFacts observation={observation} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Subject <span className="font-mono break-all">{intent.subject.id}</span>
          </p>
        )}
        {intent.kind === "input-request" && (
          <p className="text-sm">
            {intent.prompt}
            {intent.input.hint && (
              <span className="block text-xs text-muted-foreground">{intent.input.hint}</span>
            )}
          </p>
        )}
        {intent.kind === "status" && (
          <p className="text-xs text-muted-foreground">
            Status <span className="font-medium text-foreground">{intent.status}</span>
          </p>
        )}
        {evidence.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Evidence</p>
            <ul className="space-y-0.5">
              {evidence.map((reference) => (
                <li key={reference.id} className="text-xs text-muted-foreground">
                  <span className="font-mono break-all">{reference.id}</span> · {reference.kind}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {intent.actions.map((descriptor) => {
            if (descriptor.action === "correct" || descriptor.action === "defer") {
              if (answering !== descriptor.actionId) {
                return (
                  <Button
                    key={descriptor.actionId}
                    variant="outline"
                    onClick={() => setAnswering(descriptor.actionId)}
                    disabled={busy}
                  >
                    {descriptor.label}
                  </Button>
                );
              }
              if (descriptor.action === "correct") {
                return (
                  <div key={descriptor.actionId} className="w-full space-y-2">
                    <Label htmlFor={`correction-${descriptor.actionId}`}>Your correction</Label>
                    <Textarea
                      id={`correction-${descriptor.actionId}`}
                      value={correction}
                      maxLength={
                        intent.kind === "input-request" ? intent.input.maxLength : undefined
                      }
                      onChange={(event) => setCorrection(event.target.value)}
                      placeholder="What the journal got wrong"
                    />
                    <Button onClick={submitCorrection} disabled={busy}>
                      Send correction
                    </Button>
                  </div>
                );
              }
              return (
                <div key={descriptor.actionId} className="w-full space-y-2">
                  <Label htmlFor={`defer-${descriptor.actionId}`}>Come back at</Label>
                  <Input
                    id={`defer-${descriptor.actionId}`}
                    type="datetime-local"
                    value={deferUntil}
                    onChange={(event) => setDeferUntil(event.target.value)}
                  />
                  <Button onClick={submitDeferral} disabled={busy}>
                    Defer until then
                  </Button>
                </div>
              );
            }
            return (
              <Button
                key={descriptor.actionId}
                variant={descriptor.action === "dismiss" ? "outline" : "default"}
                onClick={() => void run(descriptor)}
                disabled={busy}
              >
                {descriptor.label}
              </Button>
            );
          })}
        </div>
        {notice && (
          <p
            role="status"
            className={cn(
              "text-xs",
              notice.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {notice.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
