import { eq } from "drizzle-orm";
import { accounts, db } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { syncAccount } from "@/server/sync";
import { clearAccount, setAccountArchived, transferAccount } from "@/server/trading/commands";
import { changeContext } from "@/server/trading/reconcile";

type Params = { params: Promise<{ id: string }> };

interface ActionBody {
  action: "archive" | "unarchive" | "clear" | "sync" | "transfer";
  /** For "transfer": destination account id. */
  toAccountId?: string;
}

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) return bad("Account not found", 404);
  const body = (await request.json()) as ActionBody;

  switch (body.action) {
    case "archive":
      setAccountArchived(id, true);
      return ok({ archived: true });
    case "unarchive":
      setAccountArchived(id, false);
      return ok({ archived: false });
    case "clear":
      clearAccount(id, changeContext("user", "live"));
      return ok({ cleared: true });
    case "sync":
      // The broker call stays outside any transaction.
      return ok({ sync: await syncAccount(id) });
    case "transfer": {
      if (!body.toAccountId) return bad("toAccountId is required");
      const destinationId = body.toAccountId;
      requireValue(destinationId !== id, "Choose a different destination account.");
      const destination = db.select().from(accounts).where(eq(accounts.id, destinationId)).get();
      if (!destination) return bad("Destination account not found", 404);

      transferAccount(id, destinationId, changeContext("user", "live"));
      return ok({ transferred: true });
    }
    default:
      return bad("Unknown action");
  }
});
