import { eq } from "drizzle-orm";
import { db, folders, notes } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newUuid, nowIso } from "@/server/ids";
import { recordSourceChanges } from "@/server/intelligence/composition";

type Params = { params: Promise<{ id: string }> };

interface PatchNoteBody {
  title?: string;
  content?: string;
  tags?: string[];
  folderId?: string;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!existing) return bad("Note not found", 404);
  const body = (await request.json()) as PatchNoteBody;
  if (body.folderId !== undefined) {
    const folder = db.select().from(folders).where(eq(folders.id, body.folderId)).get();
    if (!folder || folder.deletedAt || body.folderId === "all") return bad("Folder not found", 404);
  }
  // The edit and its source revision commit together.
  recordSourceChanges((tx) => {
    tx.update(notes)
      .set({
        title: body.title ?? existing.title,
        content: body.content ?? existing.content,
        tagsJson: body.tags ? JSON.stringify(body.tags) : existing.tagsJson,
        folderId: body.folderId ?? existing.folderId,
        updatedAt: nowIso(),
      })
      .where(eq(notes.id, id))
      .run();
    return [
      {
        kind: "note",
        action: "revised",
        sourceId: id,
        accountId: null,
        correlationId: newUuid(),
      },
    ];
  });
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  // The deletion and its source revision commit together: the knowledge that
  // was derived from the note is invalidated with it.
  recordSourceChanges((tx) => {
    tx.delete(notes).where(eq(notes.id, id)).run();
    return [
      {
        kind: "note",
        action: "deleted",
        sourceId: id,
        accountId: null,
        correlationId: newUuid(),
      },
    ];
  });
  return ok({ deleted: true });
});
