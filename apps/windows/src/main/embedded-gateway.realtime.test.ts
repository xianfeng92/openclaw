import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRealtimeContext,
  detectRealtimeIntent,
  extractWeatherLocation,
  injectRealtimeContext,
  resolveRealtimeQuery,
} from "./embedded-gateway.realtime.js";
import type { ChatMessage } from "./embedded-gateway.providers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("embedded-gateway realtime helpers", () => {
  it("detects realtime weather and news intents", () => {
    expect(detectRealtimeIntent("上海天气")).toBe("weather");
    expect(detectRealtimeIntent("今天的热点新闻")).toBe("news");
    expect(detectRealtimeIntent("Explain Rust ownership")).toBeNull();
  });

  it("extracts weather locations from mixed-language prompts", () => {
    expect(extractWeatherLocation("上海天气")).toBe("上海");
    expect(extractWeatherLocation("New York weather today")).toBe("New York");
    expect(extractWeatherLocation("天气")).toBeUndefined();
  });

  it("injects realtime context after leading system prompts", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system-1" },
      { role: "system", content: "system-2" },
      { role: "user", content: "上海天气" },
    ];

    const next = injectRealtimeContext(messages, "[cydeck:realtime-context]\nweather");
    expect(next.map((message) => message.role)).toEqual(["system", "system", "system", "user"]);
    expect(next[2]?.content).toContain("[cydeck:realtime-context]");
    expect(messages).toHaveLength(3);
  });

  it("builds weather context from wttr payloads", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          nearest_area: [
            {
              areaName: [{ value: "Shanghai" }],
              country: [{ value: "China" }],
            },
          ],
          current_condition: [
            {
              temp_C: "19",
              FeelsLikeC: "17",
              humidity: "70",
              lang_zh: [{ value: "多云" }],
            },
          ],
          weather: [
            { date: "2026-03-07", maxtempC: "21", mintempC: "13" },
            { date: "2026-03-08", maxtempC: "22", mintempC: "15" },
          ],
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const context = await buildRealtimeContext("上海天气");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(context).toContain("[cydeck:realtime-context]");
    expect(context).toContain("Location: Shanghai, China");
    expect(context).toContain("Condition: 多云");
    expect(context).toContain("Forecast 2026-03-07");
  });

  it("builds direct weather replies from wttr payloads", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          nearest_area: [
            {
              areaName: [{ value: "Shanghai" }],
              country: [{ value: "China" }],
            },
          ],
          current_condition: [
            {
              temp_C: "19",
              FeelsLikeC: "17",
              humidity: "70",
              lang_zh: [{ value: "多云" }],
            },
          ],
          weather: [{ date: "2026-03-07", maxtempC: "21", mintempC: "13" }],
        }),
      );
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const resolution = await resolveRealtimeQuery("上海天气");
    expect(resolution?.assistantText).toContain("Shanghai, China 当前天气");
    expect(resolution?.assistantText).toContain("天气：多云");
    expect(resolution?.assistantText).toContain("气温：19C");
  });

  it("asks for a city when weather query has no location", async () => {
    const resolution = await resolveRealtimeQuery("天气");
    expect(resolution?.assistantText).toContain("请告诉我要查询的城市");
  });

  it("builds news context from rss feeds", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(`<?xml version="1.0" encoding="utf-8"?>
<rss>
  <channel>
    <item>
      <title><![CDATA[Top Story]]></title>
      <link>https://example.com/top-story</link>
      <pubDate>Sat, 07 Mar 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Story</title>
      <link>https://example.com/second-story</link>
      <pubDate>Sat, 07 Mar 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const context = await buildRealtimeContext("今天的热点新闻");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(context).toContain("[cydeck:realtime-context]");
    expect(context).toContain("Top Story");
    expect(context).toContain("https://example.com/top-story");
    expect(context).toContain("Second Story");
  });

  it("builds direct news replies from rss feeds", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(`<?xml version="1.0" encoding="utf-8"?>
<rss>
  <channel>
    <item>
      <title>Top Story</title>
      <link>https://example.com/top-story</link>
      <pubDate>Sat, 07 Mar 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const resolution = await resolveRealtimeQuery("今天的热点新闻");
    expect(resolution?.assistantText).toContain("今天的热点新闻");
    expect(resolution?.assistantText).toContain("Top Story");
    expect(resolution?.assistantText).toContain("https://example.com/top-story");
  });
});
