"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ControlsResponse, IntelligenceStatusResponse } from "@/lib/intelligence-interactions";
import { postJson, useApi } from "@/lib/use-api";

/**
 * The journal controls.
 *
 * The two switches the operator owns — the proactive opt-in and the pause —
 * and the state the journal serves about itself: the background AI policy
 * (read-only here: the AI section stays its one editor), the worker status
 * and the engagement defaults.
 */

export function IntelligenceControls() {
  const controls = useApi<ControlsResponse>("/api/intelligence/controls");
  const status = useApi<IntelligenceStatusResponse>("/api/intelligence/status");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const current = controls.data?.controls;

  /** Writes one switch and reads the merged state back. */
  const write = async (patch: { proactiveOptIn?: boolean; paused?: boolean }) => {
    setBusy(true);
    setFailure("");
    try {
      await postJson("/api/intelligence/controls", patch);
      controls.refresh();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not save the controls.");
    } finally {
      setBusy(false);
    }
  };

  const defaults = status.data?.status.engagementDefaults;
  // The policy comes from the status surface: it is the state the journal
  // runs under, and the status surface already serves it.
  const policy = status.data?.status.backgroundPolicy;
  const worker = status.data?.status.worker;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Journal insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="intelligence-proactive-opt-in"
              aria-label="Proactive insights"
              checked={current?.proactiveOptIn ?? false}
              disabled={busy || !current}
              onCheckedChange={(checked) => void write({ proactiveOptIn: checked === true })}
            />
            <Label htmlFor="intelligence-proactive-opt-in">
              Proactive insights
              <span className="block text-xs font-normal text-muted-foreground">
                The journal may raise what it noticed on its own. With this off the inbox holds only
                what you asked for.
              </span>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="intelligence-paused"
              aria-label="Pause journal insights"
              checked={current?.paused ?? false}
              disabled={busy || !current}
              onCheckedChange={(checked) => void write({ paused: checked === true })}
            />
            <Label htmlFor="intelligence-paused">
              Pause journal insights
              <span className="block text-xs font-normal text-muted-foreground">
                The journal raises nothing while it is paused. Resuming brings it back.
              </span>
            </Label>
          </div>
          {failure && (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Background AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            The policy is edited in the{" "}
            <a href="#ai-settings" className="underline underline-offset-2 hover:text-foreground">
              AI section
            </a>
            . This is the state the journal serves:
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Enabled</dt>
            <dd>{policy ? (policy.enabled ? "Yes" : "No") : "Unknown"}</dd>
            <dt className="text-muted-foreground">Accounts</dt>
            <dd>{policy ? policy.accounts.length : 0}</dd>
            <dt className="text-muted-foreground">Tools</dt>
            <dd>{policy?.capabilities.tools ? "Allowed" : "Not allowed"}</dd>
            <dt className="text-muted-foreground">Structured output</dt>
            <dd>{policy?.capabilities.structuredOutput ? "Allowed" : "Not allowed"}</dd>
            <dt className="text-muted-foreground">Context characters</dt>
            <dd className="tnum">{policy?.maxInputCharacters ?? 0}</dd>
            <dt className="text-muted-foreground">Revision</dt>
            <dd className="tnum">{policy?.revision ?? 0}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Worker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {worker ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">State</dt>
              <dd>{worker.state}</dd>
              <dt className="text-muted-foreground">Processed</dt>
              <dd className="tnum">{worker.processed}</dd>
              <dt className="text-muted-foreground">Failed</dt>
              <dd className="tnum">{worker.failed}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">
              No worker runs in this web process. The journal raises what it noticed when you open
              the journal.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Engagement defaults</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Proactive insights per day</dt>
            <dd className="tnum">{defaults?.proactivePerDay ?? 0}</dd>
            <dt className="text-muted-foreground">Cooldown between insights</dt>
            <dd className="tnum">
              {defaults ? `${Math.round(defaults.proactiveCooldownMs / 3_600_000)} hours` : "–"}
            </dd>
            <dt className="text-muted-foreground">Opportunity lifetime</dt>
            <dd className="tnum">
              {defaults ? `${Math.round(defaults.opportunityExpiryMs / 86_400_000)} days` : "–"}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
