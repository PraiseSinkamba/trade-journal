"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type InteractionIntent,
  type ObservationSummary,
  type OpportunitiesResponse,
  type ObservationsResponse,
  type OpportunitySummary,
} from "@/lib/intelligence-interactions";
import { ApiError, postJson, useApi } from "@/lib/use-api";
import { InteractionCard, ObservationFacts } from "./interaction-card";

/**
 * The inbox.
 *
 * A pull surface: it reads what the journal noticed and offers what the
 * server authorised. Nothing is pushed and no provider is called, so the
 * journal never guesses that the operator is idle.
 *
 * Intents are matched to their subject by id, never by the position of an
 * array: the surfaces answer in their own order.
 */

/** What the observation route answers when it starts a review. */
interface ReviewStarted {
  readonly workflowId: string;
  readonly revision: number;
  readonly intent: InteractionIntent | null;
}

export function IntelligenceInbox() {
  const observations = useApi<ObservationsResponse>("/api/intelligence/observations");
  const opportunities = useApi<OpportunitiesResponse>("/api/intelligence/opportunities");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  /**
   * The observations this client has started a review for.
   *
   * The server serves the review state of every observation, so the client
   * knows after a reload which observations already carry a review. The
   * session keeps its own list as well: an observation that was already put
   * up for review is never offered a second review while the session lives.
   */
  const [startedReviews, setStartedReviews] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The intents the server answered with when a review was started, by
   * intent id.
   *
   * The server pairs the review that waits for the operator, so the review it
   * just started is served at the next read. The client keeps what it was
   * handed so the operator can act on the review right away, before the next
   * read answers.
   */
  const [localIntents, setLocalIntents] = useState<ReadonlyMap<string, InteractionIntent>>(
    () => new Map(),
  );

  const refresh = () => {
    observations.refresh();
    opportunities.refresh();
  };

  const servedIntents = useMemo<readonly InteractionIntent[]>(
    () => [...(observations.data?.intents ?? []), ...(opportunities.data?.intents ?? [])],
    [observations.data?.intents, opportunities.data?.intents],
  );
  const servedIntentIds = useMemo(
    () => new Set(servedIntents.map((intent) => intent.intentId)),
    [servedIntents],
  );
  const servedReviewSubjects = useMemo(
    () =>
      new Set(
        servedIntents
          .filter((intent) => intent.kind === "observation-review")
          .map((intent) => intent.subject.id),
      ),
    [servedIntents],
  );

  /**
   * The served intent wins: it is the one the server still authorises.
   *
   * Only a served review intent competes with a locally started review. A
   * served status intent speaks about an opportunity, not about the review,
   * so it never hides the review card.
   *
   * A locally started review survives every refresh, because the server may
   * pair another workflow of the observation when it serves. It is dropped
   * once the server serves a review intent for the same observation, or
   * once the operator acted on it.
   */
  const localVisible = useMemo(
    () =>
      [...localIntents.values()].filter(
        (intent) =>
          !servedIntentIds.has(intent.intentId) && !servedReviewSubjects.has(intent.subject.id),
      ),
    [localIntents, servedIntentIds, servedReviewSubjects],
  );

  useEffect(() => {
    setLocalIntents((current) => {
      const kept = new Map(current);
      for (const intent of current.values()) {
        if (servedIntentIds.has(intent.intentId) || servedReviewSubjects.has(intent.subject.id)) {
          kept.delete(intent.intentId);
        }
      }
      return kept.size === current.size ? current : kept;
    });
  }, [servedIntentIds, servedReviewSubjects]);

  const observationList = observations.data?.observations ?? [];
  const opportunityList = opportunities.data?.opportunities ?? [];

  const observationOf = (subjectId: string): ObservationSummary | undefined =>
    observationList.find((observation) => observation.id === subjectId);
  const opportunityOf = (subjectId: string): OpportunitySummary | undefined =>
    opportunityList.find((opportunity) => opportunity.subjectId === subjectId);

  /** Starts the review workflow of one observation the journal has not asked about yet. */
  const startReview = async (observation: ObservationSummary) => {
    setReviewing(observation.id);
    setFailure("");
    try {
      const answer = await postJson<ReviewStarted>("/api/intelligence/observations", {
        observationId: observation.id,
      });
      setStartedReviews((current) => new Set(current).add(observation.id));
      const intent = answer.intent;
      if (intent && intent.kind === "observation-review") {
        setLocalIntents((current) => new Map(current).set(intent.intentId, intent));
      }
      refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        // The observation already carries a review: the server refuses a
        // second one, and the list is refreshed so the operator sees the
        // review that is live.
        setFailure("This observation is already under review.");
        refresh();
      } else {
        setFailure(cause instanceof Error ? cause.message : "Could not start the review.");
      }
    } finally {
      setReviewing(null);
    }
  };

  const intents: readonly InteractionIntent[] = [...servedIntents, ...localVisible];

  // An observation that carries a review intent is rendered by that intent,
  // which carries the facts too.
  const covered = new Set<string>([
    ...servedReviewSubjects,
    ...localVisible.map((intent) => intent.subject.id),
  ]);

  return (
    <div className="space-y-3">
      {intents.map((intent) => (
        <InteractionCard
          key={intent.intentId}
          intent={intent}
          observation={observationOf(intent.subject.id)}
          opportunity={opportunityOf(intent.subject.id)}
          onChanged={(applied) => {
            if (applied) {
              // The card is spent: the server took the action, so the local
              // intent is no longer the truth about the workflow.
              setLocalIntents((current) => {
                if (!current.has(intent.intentId)) return current;
                const kept = new Map(current);
                kept.delete(intent.intentId);
                return kept;
              });
            }
            refresh();
          }}
        />
      ))}
      {observationList
        .filter((observation) => !covered.has(observation.id))
        .map((observation) => (
          <Card key={`observation:${observation.id}`}>
            <CardHeader>
              <CardTitle>Observation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ObservationFacts observation={observation} />
              {/* The server serves the review the observation carries: an
                  observation that is under review or already reviewed is not
                  offered a review again. The session keeps its own list as
                  well, so a review that was just started is never offered
                  twice while it is still being read back. */}
              {observation.reviewState === "unreviewed" && !startedReviews.has(observation.id) && (
                <Button
                  onClick={() => void startReview(observation)}
                  disabled={reviewing === observation.id}
                >
                  Review
                </Button>
              )}
              {observation.reviewState === "live" && (
                <p className="text-xs text-muted-foreground">This observation is being reviewed.</p>
              )}
              {observation.reviewState === "reviewed" && (
                <p className="text-xs text-muted-foreground">This observation was reviewed.</p>
              )}
            </CardContent>
          </Card>
        ))}
      {failure && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
      {!observations.loading &&
        !opportunities.loading &&
        intents.length === 0 &&
        observationList.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing is waiting for you.</p>
        )}
    </div>
  );
}
