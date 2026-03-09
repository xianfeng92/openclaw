import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCyDeckRealtimeQuery } from "./cydeck-realtime.js";

function makeRss(items: Array<{ title: string; link?: string; pubDate?: string }>): string {
  const body = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>${item.link ?? ""}</link><pubDate>${item.pubDate ?? ""}</pubDate></item>`,
    )
    .join("");
  return `<rss><channel>${body}</channel></rss>`;
}

describe("resolveCyDeckRealtimeQuery news handling", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers curated AI feeds for AI-circle hotspot requests", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        makeRss([
          {
            title: "OpenAI ships a new agent runtime",
            link: "https://example.test/openai-agent-runtime",
            pubDate: "Sun, 08 Mar 2026 10:00:00 GMT",
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await resolveCyDeckRealtimeQuery("帮我看看今天 ai 圈有什么热点");

    expect(result?.intent).toBe("news");
    expect(result?.assistantText).toContain("今天 AI 圈热点：");
    expect(result?.assistantText).toContain("OpenAI ships a new agent runtime");

    const firstUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(firstUrl).toContain("techcrunch.com/category/artificial-intelligence/feed/");
  });

  it("falls back to Google News RSS when curated AI feeds and Bing return no usable items", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<feed></feed>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          makeRss([
            {
              title: "Anthropic expands enterprise agent controls",
              link: "https://example.test/anthropic-enterprise-agent-controls",
              pubDate: "Sun, 08 Mar 2026 11:00:00 GMT",
            },
          ]),
          { status: 200 },
        ),
      );

    const result = await resolveCyDeckRealtimeQuery("今天 ai 圈热点");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(String(fetchMock.mock.calls[4]?.[0] ?? "")).toContain("bing.com/news/search");
    expect(String(fetchMock.mock.calls[5]?.[0] ?? "")).toContain("news.google.com/rss/search");
    expect(result?.assistantText).toContain("Anthropic expands enterprise agent controls");
  });

  it("returns an AI-specific empty-state message when all news sources are empty", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<feed></feed>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<rss><channel></channel></rss>", { status: 200 }));

    const result = await resolveCyDeckRealtimeQuery("今天 ai 圈热点");

    expect(result).toEqual({
      intent: "news",
      assistantText: "我刚才尝试获取 AI 圈热点，但暂时没有抓到可用结果。请稍后重试。",
    });
  });
});
