type CyDeckChatMessage = {
  role: string;
  content: string;
};

type RealtimeIntent = "news" | "weather" | null;

type RealtimeResolution = {
  intent: "news" | "weather";
  assistantText: string;
};

type WeatherSnapshot = {
  query: string;
  fetchedAt: string;
  location: string;
  condition: string;
  tempC: string;
  feelsLikeC: string;
  humidity: string;
  forecast: Array<{
    date: string;
    minTempC: string;
    maxTempC: string;
  }>;
};

type KnownWeatherLocation = {
  aliases: string[];
  latitude: number;
  longitude: number;
  timezone: string;
  label: string;
};

const NEWS_TOPICS_RE = /(热点|新闻|头条|快讯|news|headline|headlines|breaking)/iu;
const WEATHER_RE = /(天气|气温|温度|预报|降雨|weather|forecast|temperature)/iu;
const CURRENT_INFO_RE = /(今天|今日|实时|当前|现在|最新|最近|today|current|latest|recent)/iu;
const STRIP_WEATHER_TERMS_RE =
  /(天气|气温|温度|预报|weather|forecast|temperature|today|current|latest|现在|今天|今日|请问|查询|一下)/giu;

const KNOWN_WEATHER_LOCATIONS: KnownWeatherLocation[] = [
  { aliases: ["上海", "上海市", "shanghai"], latitude: 31.2304, longitude: 121.4737, timezone: "Asia/Shanghai", label: "Shanghai, China" },
  { aliases: ["北京", "北京市", "beijing"], latitude: 39.9042, longitude: 116.4074, timezone: "Asia/Shanghai", label: "Beijing, China" },
  { aliases: ["广州", "广州市", "guangzhou"], latitude: 23.1291, longitude: 113.2644, timezone: "Asia/Shanghai", label: "Guangzhou, China" },
  { aliases: ["深圳", "深圳市", "shenzhen"], latitude: 22.5431, longitude: 114.0579, timezone: "Asia/Shanghai", label: "Shenzhen, China" },
  { aliases: ["杭州", "杭州市", "hangzhou"], latitude: 30.2741, longitude: 120.1551, timezone: "Asia/Shanghai", label: "Hangzhou, China" },
  { aliases: ["南京", "南京市", "nanjing"], latitude: 32.0603, longitude: 118.7969, timezone: "Asia/Shanghai", label: "Nanjing, China" },
  { aliases: ["成都", "成都市", "chengdu"], latitude: 30.5728, longitude: 104.0668, timezone: "Asia/Shanghai", label: "Chengdu, China" },
  { aliases: ["武汉", "武汉市", "wuhan"], latitude: 30.5928, longitude: 114.3055, timezone: "Asia/Shanghai", label: "Wuhan, China" },
  { aliases: ["东京", "tokyo"], latitude: 35.6762, longitude: 139.6503, timezone: "Asia/Tokyo", label: "Tokyo, Japan" },
  { aliases: ["纽约", "newyork", "new york", "nyc"], latitude: 40.7128, longitude: -74.006, timezone: "America/New_York", label: "New York, USA" },
];

function normalizeLocationKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s,，。.'’·-]+/gu, "");
}

function resolveKnownWeatherLocation(location: string): KnownWeatherLocation | undefined {
  const key = normalizeLocationKey(location);
  return KNOWN_WEATHER_LOCATIONS.find((entry) =>
    entry.aliases.some((alias) => normalizeLocationKey(alias) === key),
  );
}

function describeWeatherCodeZh(code: unknown): string {
  const normalized = typeof code === "number" ? code : Number(code);
  switch (normalized) {
    case 0:
      return "晴";
    case 1:
      return "大致晴朗";
    case 2:
      return "局部多云";
    case 3:
      return "阴";
    case 45:
    case 48:
      return "有雾";
    case 51:
    case 53:
    case 55:
      return "毛毛雨";
    case 61:
    case 63:
    case 65:
      return "下雨";
    case 71:
    case 73:
    case 75:
      return "下雪";
    case 80:
    case 81:
    case 82:
      return "阵雨";
    case 95:
      return "雷暴";
    default:
      return "";
  }
}

function detectIntent(query: string, sessionMessages: CyDeckChatMessage[]): RealtimeIntent {
  if (NEWS_TOPICS_RE.test(query)) {
    return "news";
  }
  if (WEATHER_RE.test(query)) {
    return "weather";
  }
  const trimmed = query.trim();
  if (!trimmed || /\s/u.test(trimmed)) {
    return null;
  }
  const lastUserMessage = [...sessionMessages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim() !== trimmed);
  if (lastUserMessage && WEATHER_RE.test(lastUserMessage.content)) {
    return "weather";
  }
  return null;
}

function extractWeatherLocation(query: string, sessionMessages: CyDeckChatMessage[]): string {
  const stripped = query.replace(STRIP_WEATHER_TERMS_RE, "").trim();
  if (stripped) {
    return stripped;
  }

  const lastUserMessage = [...sessionMessages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim() !== query.trim());
  if (lastUserMessage && WEATHER_RE.test(lastUserMessage.content)) {
    return query.trim();
  }
  return "";
}

function buildWeatherReply(snapshot: WeatherSnapshot): string {
  const lines: string[] = [
    `${snapshot.location} 当前天气`,
    `数据时间：${snapshot.fetchedAt}`,
  ];
  if (snapshot.condition) {
    lines.push(`天气：${snapshot.condition}`);
  }
  if (snapshot.tempC) {
    lines.push(`气温：${snapshot.tempC}C`);
  }
  if (snapshot.feelsLikeC) {
    lines.push(`体感：${snapshot.feelsLikeC}C`);
  }
  if (snapshot.humidity) {
    lines.push(`湿度：${snapshot.humidity}%`);
  }
  if (snapshot.forecast.length > 0) {
    lines.push("", "未来预报：");
    for (const day of snapshot.forecast) {
      lines.push(`- ${day.date || "day"}：最低 ${day.minTempC || "?"}C，最高 ${day.maxTempC || "?"}C`);
    }
  }
  return lines.join("\n").trim();
}

async function fetchOpenMeteoWeather(
  location: KnownWeatherLocation,
  query: string,
  signal?: AbortSignal,
): Promise<WeatherSnapshot | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(location.timezone)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as Record<string, any>;
  const current = payload.current ?? {};
  const daily = payload.daily ?? {};
  const forecast = Array.isArray(daily.time)
    ? daily.time.slice(0, 3).map((date: string, index: number) => ({
        date,
        minTempC: String(daily.temperature_2m_min?.[index] ?? ""),
        maxTempC: String(daily.temperature_2m_max?.[index] ?? ""),
      }))
    : [];
  return {
    query,
    fetchedAt: new Date().toISOString(),
    location: location.label,
    condition: describeWeatherCodeZh(current.weather_code),
    tempC: String(current.temperature_2m ?? ""),
    feelsLikeC: String(current.apparent_temperature ?? ""),
    humidity: String(current.relative_humidity_2m ?? ""),
    forecast,
  };
}

async function fetchWttrWeather(location: string, signal?: AbortSignal): Promise<WeatherSnapshot | null> {
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh-cn`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as Record<string, any>;
  const current = Array.isArray(payload.current_condition) ? payload.current_condition[0] ?? {} : {};
  const weather = Array.isArray(payload.weather) ? payload.weather : [];
  const condition = Array.isArray(current.lang_zh_cn)
    ? current.lang_zh_cn[0]?.value ?? ""
    : Array.isArray(current.weatherDesc)
      ? current.weatherDesc[0]?.value ?? ""
      : "";
  return {
    query: location,
    fetchedAt: new Date().toISOString(),
    location: location,
    condition,
    tempC: String(current.temp_C ?? ""),
    feelsLikeC: String(current.FeelsLikeC ?? ""),
    humidity: String(current.humidity ?? ""),
    forecast: weather.slice(0, 3).map((entry: any) => ({
      date: String(entry.date ?? ""),
      minTempC: String(entry.mintempC ?? ""),
      maxTempC: String(entry.maxtempC ?? ""),
    })),
  };
}

async function resolveWeather(query: string, sessionMessages: CyDeckChatMessage[], signal?: AbortSignal): Promise<RealtimeResolution | null> {
  const location = extractWeatherLocation(query, sessionMessages);
  if (!location) {
    return {
      intent: "weather",
      assistantText: "请告诉我你要查询的城市，例如：上海天气。",
    };
  }
  const known = resolveKnownWeatherLocation(location);
  const snapshot = known
    ? await fetchOpenMeteoWeather(known, query, signal)
    : await fetchWttrWeather(location, signal);

  if (!snapshot) {
    return {
      intent: "weather",
      assistantText: "我刚才尝试获取实时天气，但天气源暂时不可用。请稍后重试，或换一个更具体的城市名。",
    };
  }

  return {
    intent: "weather",
    assistantText: buildWeatherReply(snapshot),
  };
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/<[^>]+>/gu, "")
    .trim();
}

function extractXmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "iu"));
  return match?.[1] ? decodeXmlText(match[1]) : "";
}

async function resolveNews(query: string, signal?: AbortSignal): Promise<RealtimeResolution | null> {
  const normalized = query.trim();
  const newsQuery =
    !normalized || /^(今天的?)?(热点|新闻|头条|快讯)$/iu.test(normalized)
      ? "latest news"
      : normalized;
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(newsQuery)}&format=rss&mkt=zh-CN`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return {
      intent: "news",
      assistantText: "我刚才尝试获取热点新闻，但新闻源暂时不可用。请稍后重试。",
    };
  }
  const xml = await response.text();
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/giu))
    .slice(0, 5)
    .map((match) => ({
      title: extractXmlTag(match[1], "title"),
      link: extractXmlTag(match[1], "link"),
      pubDate: extractXmlTag(match[1], "pubDate"),
    }))
    .filter((item) => item.title);

  if (items.length === 0) {
    return {
      intent: "news",
      assistantText: "我刚才尝试获取热点新闻，但暂时没有抓到可用结果。请稍后重试。",
    };
  }

  const lines = ["今天的热点新闻：", ""];
  for (const item of items) {
    lines.push(`- ${item.title}`);
    if (item.pubDate) {
      lines.push(`  时间：${item.pubDate}`);
    }
    if (item.link) {
      lines.push(`  链接：${item.link}`);
    }
  }

  return {
    intent: "news",
    assistantText: lines.join("\n").trim(),
  };
}

export async function resolveCyDeckRealtimeQuery(
  query: string,
  options: { sessionMessages?: CyDeckChatMessage[] } = {},
  signal?: AbortSignal,
): Promise<RealtimeResolution | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const sessionMessages = options.sessionMessages ?? [];
  const intent = detectIntent(trimmed, sessionMessages);
  if (intent === "weather") {
    return await resolveWeather(trimmed, sessionMessages, signal);
  }
  if (intent === "news" && (CURRENT_INFO_RE.test(trimmed) || NEWS_TOPICS_RE.test(trimmed))) {
    return await resolveNews(trimmed, signal);
  }
  return null;
}
