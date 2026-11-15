import { bad, handler, ok } from "@/server/api";
import { listConversations, listMessages, resolveScope, scopeParam } from "../queries";

/**
 * The conversation surface (Phase 18).
 *
 * `GET` answers `{ conversations }`: the open conversations of the scope,
 * each with its messages.
 */
export const GET = handler(
  async (request: Request) => {
    const scope = resolveScope(scopeParam(new URL(request.url)));
    if (!scope) return bad("scope_denied", 403);

    const rows = listConversations(scope);
    const messages = listMessages(rows.map((row) => row.id));

    return ok({
      conversations: rows.map((row) => ({
        id: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        accountId: row.accountId,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messages: messages
          .filter((message) => message.conversationId === row.id)
          .map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
          })),
      })),
    });
  },
  { sanitize: true },
);
