import { eq } from "drizzle-orm";
import { db, folders, notes } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newUuid, nowIso } from "@/server/ids";
import { recordSourceChanges } from "@/server/intelligence/composition";

type Params = { params: Promise<{ id: string }> };

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const folder = db.select().from(folders).where(eq(folders.id, id)).get();
  if (!folder || folder.deletedAt) return bad("Folder not found", 404);
  if (id === "all" || id === "my-notes") return bad("This folder cannot be deleted.");

  // The notes of the folder move to "my-notes", so each of them changes
  // visibility. Every moved note gets its own source revision, under one
  // correlation id: the whole folder deletion is one operation.
  const correlationId = newUuid();
  recordSourceChanges((tx) => {
    // The moved notes are read inside the transaction, so a note that arrived
    // in the meantime is moved with a revision of its own.
    const moved = tx.select({ id: notes.id }).from(notes).where(eq(notes.folderId, id)).all();
    tx.update(notes).set({ folderId: "my-notes" }).where(eq(notes.folderId, id)).run();
    // Keep a tombstone so bootstrap cannot recreate a deleted built-in section.
    tx.update(folders).set({ deletedAt: nowIso() }).where(eq(folders.id, id)).run();
    return moved.map((note) => ({
      kind: "note" as const,
      action: "revised" as const,
      sourceId: note.id,
      accountId: null,
      correlationId,
    }));
  });
  return ok({ deleted: true });
});
