import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ImportPage from "@/app/import/page";
import type { Mock } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockPostJson = vi.fn();
vi.mock("@/lib/use-api", () => ({
  useApi: vi.fn().mockImplementation(() => ({
    data: {
      formats: [{ id: "tradezella", label: "TradeZella" }],
      timeZone: "UTC",
      importTimeZone: "UTC",
      aiConnections: { openai: { configured: false }, anthropic: { configured: false } },
    },
    error: null,
  })),
  postJson: mockPostJson,
}));

const tradezellaPreview = {
  detected: "tradezella",
  totals: {
    executions: 3,
    symbols: 1,
    skippedRows: 0,
    skippedReasons: [],
    skippedReasonsTruncated: false,
    from: "2024-01-01",
    to: "2024-01-03",
  },
  headers: ["Symbol", "Side", "Quantity", "Price", "Time"],
  needsMapping: false,
  timeZone: "UTC",
  executions: [
    { symbol: "AAPL", side: "BUY", quantity: 10, price: 150, executedAt: "2024-01-01T09:30:00Z" },
  ],
};

const ninjatraderPreview = {
  detected: "ninjatrader",
  totals: {
    executions: 3,
    symbols: 1,
    skippedRows: 0,
    skippedReasons: [],
    skippedReasonsTruncated: false,
    from: "2024-01-01",
    to: "2024-01-03",
  },
  needsMapping: false,
  timeZone: "UTC",
  executions: [],
};

describe("refute-and-remap", () => {
  it("renders the refute link after a detected non-ninjatrader format", async () => {
    mockPostJson.mockResolvedValueOnce(tradezellaPreview);
    render(<ImportPage />);

    await waitFor(() => {
      expect(screen.getByText(/tradezella/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Wrong format\? Map columns manually/i)).toBeInTheDocument();
  });

  it("hides the refute link for ninjatrader format", async () => {
    mockPostJson.mockResolvedValueOnce(ninjatraderPreview);
    render(<ImportPage />);

    await waitFor(() => {
      expect(screen.getByText(/ninjatrader/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Wrong format\? Map columns manually/i)).not.toBeInTheDocument();
  });

  it("clicking refute link shows the column mapper", async () => {
    mockPostJson.mockResolvedValueOnce(tradezellaPreview);
    render(<ImportPage />);

    await waitFor(() => {
      expect(screen.getByText(/tradezella/i)).toBeInTheDocument();
    });

    const link = screen.getByText(/Wrong format\? Map columns manually/i);
    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByText(/Format not recognized/i)).toBeInTheDocument();
    });
  });

  it("clicking refute link hides the totals preview", async () => {
    mockPostJson.mockResolvedValueOnce(tradezellaPreview);
    render(<ImportPage />);

    await waitFor(() => {
      expect(screen.getByText(/tradezella/i)).toBeInTheDocument();
    });

    const link = screen.getByText(/Wrong format\? Map columns manually/i);
    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.queryByText(/3 executions/)).not.toBeInTheDocument();
    });
  });
});
