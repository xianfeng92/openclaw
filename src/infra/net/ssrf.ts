import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, type Dispatcher } from "undici";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export class SsrFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrFBlockedError";
  }
}

export type LookupFn = typeof dnsLookup;

export type SsrFPolicy = {
  allowPrivateNetwork?: boolean;
  allowedHostnames?: string[];
};

const PRIVATE_IPV6_PREFIXES = ["fe80:", "fec0:", "fc", "fd"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function normalizeHostnameSet(values?: string[]): Set<string> {
  if (!values || values.length === 0) {
    return new Set<string>();
  }
  return new Set(values.map((value) => normalizeHostname(value)).filter(Boolean));
}

function parseStrictIpv4Octet(part: string): number | null {
  if (!/^[0-9]+$/.test(part)) {
    return null;
  }
  const value = Number.parseInt(part, 10);
  if (Number.isNaN(value) || value < 0 || value > 255) {
    return null;
  }
  // Accept canonical dotted-decimal only (no leading zeroes / alternate radices).
  if (part !== String(value)) {
    return null;
  }
  return value;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  for (const part of parts) {
    if (parseStrictIpv4Octet(part) === null) {
      return null;
    }
  }
  return parts.map((part) => Number.parseInt(part, 10));
}

function classifyIpv4Part(part: string): "decimal" | "hex" | "invalid-hex" | "non-numeric" {
  if (/^0x[0-9a-f]+$/i.test(part)) {
    return "hex";
  }
  if (/^0x/i.test(part)) {
    return "invalid-hex";
  }
  if (/^[0-9]+$/.test(part)) {
    return "decimal";
  }
  return "non-numeric";
}

function isUnsupportedLegacyIpv4Literal(address: string): boolean {
  const parts = address.split(".");
  if (parts.length === 0 || parts.length > 4) {
    return false;
  }
  if (parts.some((part) => part.length === 0)) {
    return true;
  }

  const partKinds = parts.map(classifyIpv4Part);
  if (partKinds.some((kind) => kind === "non-numeric")) {
    return false;
  }
  if (partKinds.some((kind) => kind === "invalid-hex")) {
    return true;
  }

  if (parts.length !== 4) {
    return true;
  }
  for (const part of parts) {
    if (/^0x/i.test(part)) {
      return true;
    }
    const value = Number.parseInt(part, 10);
    if (Number.isNaN(value) || value > 255 || part !== String(value)) {
      return true;
    }
  }
  return false;
}

function parseIpv4FromMappedIpv6(mapped: string): number[] | null {
  if (mapped.includes(".")) {
    return parseIpv4(mapped);
  }
  const parts = mapped.split(":").filter(Boolean);
  if (parts.length === 1) {
    const value = Number.parseInt(parts[0], 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff_ffff) {
      return null;
    }
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  }
  if (parts.length !== 2) {
    return null;
  }
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    high < 0 ||
    low < 0 ||
    high > 0xffff ||
    low > 0xffff
  ) {
    return null;
  }
  const value = (high << 16) + low;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

type Ipv4Cidr = {
  base: readonly [number, number, number, number];
  prefixLength: number;
};

function ipv4ToUint(parts: readonly number[]): number {
  const [a, b, c, d] = parts;
  return (((a << 24) >>> 0) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4RangeFromCidr(cidr: Ipv4Cidr): readonly [start: number, end: number] {
  const base = ipv4ToUint(cidr.base);
  const hostBits = 32 - cidr.prefixLength;
  const mask = cidr.prefixLength === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
  const start = (base & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return [start, end];
}

const BLOCKED_IPV4_SPECIAL_USE_CIDRS: readonly Ipv4Cidr[] = [
  { base: [0, 0, 0, 0], prefixLength: 8 },
  { base: [10, 0, 0, 0], prefixLength: 8 },
  { base: [100, 64, 0, 0], prefixLength: 10 },
  { base: [127, 0, 0, 0], prefixLength: 8 },
  { base: [169, 254, 0, 0], prefixLength: 16 },
  { base: [172, 16, 0, 0], prefixLength: 12 },
  { base: [192, 0, 0, 0], prefixLength: 24 },
  { base: [192, 0, 2, 0], prefixLength: 24 },
  { base: [192, 88, 99, 0], prefixLength: 24 },
  { base: [192, 168, 0, 0], prefixLength: 16 },
  { base: [198, 18, 0, 0], prefixLength: 15 },
  { base: [198, 51, 100, 0], prefixLength: 24 },
  { base: [203, 0, 113, 0], prefixLength: 24 },
  { base: [224, 0, 0, 0], prefixLength: 4 },
  { base: [240, 0, 0, 0], prefixLength: 4 },
];

const BLOCKED_IPV4_SPECIAL_USE_RANGES = BLOCKED_IPV4_SPECIAL_USE_CIDRS.map(ipv4RangeFromCidr);

function isBlockedIpv4SpecialUse(parts: number[]): boolean {
  if (parts.length !== 4) {
    return false;
  }
  const value = ipv4ToUint(parts);
  for (const [start, end] of BLOCKED_IPV4_SPECIAL_USE_RANGES) {
    if (value >= start && value <= end) {
      return true;
    }
  }
  return false;
}

export function isPrivateIpAddress(address: string): boolean {
  let normalized = address.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    const ipv4 = parseIpv4FromMappedIpv6(mapped);
    if (ipv4) {
      return isBlockedIpv4SpecialUse(ipv4);
    }
  }

  if (normalized.includes(":")) {
    if (normalized === "::" || normalized === "::1") {
      return true;
    }
    return PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isBlockedIpv4SpecialUse(ipv4);
  }
  // Fail closed for legacy/non-canonical IPv4 literals before DNS lookup.
  if (isUnsupportedLegacyIpv4Literal(normalized)) {
    return true;
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function createPinnedLookup(params: {
  hostname: string;
  addresses: string[];
  fallback?: typeof dnsLookupCb;
}): typeof dnsLookupCb {
  const normalizedHost = normalizeHostname(params.hostname);
  const fallback = params.fallback ?? dnsLookupCb;
  const fallbackLookup = fallback as unknown as (
    hostname: string,
    callback: LookupCallback,
  ) => void;
  const fallbackWithOptions = fallback as unknown as (
    hostname: string,
    options: unknown,
    callback: LookupCallback,
  ) => void;
  const records = params.addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  let index = 0;

  return ((host: string, options?: unknown, callback?: unknown) => {
    const cb: LookupCallback =
      typeof options === "function" ? (options as LookupCallback) : (callback as LookupCallback);
    if (!cb) {
      return;
    }
    const normalized = normalizeHostname(host);
    if (!normalized || normalized !== normalizedHost) {
      if (typeof options === "function" || options === undefined) {
        return fallbackLookup(host, cb);
      }
      return fallbackWithOptions(host, options, cb);
    }

    const opts =
      typeof options === "object" && options !== null
        ? (options as { all?: boolean; family?: number })
        : {};
    const requestedFamily =
      typeof options === "number" ? options : typeof opts.family === "number" ? opts.family : 0;
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((entry) => entry.family === requestedFamily)
        : records;
    const usable = candidates.length > 0 ? candidates : records;
    if (opts.all) {
      cb(null, usable as LookupAddress[]);
      return;
    }
    const chosen = usable[index % usable.length];
    index += 1;
    cb(null, chosen.address, chosen.family);
  }) as typeof dnsLookupCb;
}

export type PinnedHostname = {
  hostname: string;
  addresses: string[];
  lookup: typeof dnsLookupCb;
};

export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { lookupFn?: LookupFn; policy?: SsrFPolicy } = {},
): Promise<PinnedHostname> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Invalid hostname");
  }

  const allowPrivateNetwork = Boolean(params.policy?.allowPrivateNetwork);
  const allowedHostnames = normalizeHostnameSet(params.policy?.allowedHostnames);
  const isExplicitAllowed = allowedHostnames.has(normalized);

  if (!allowPrivateNetwork && !isExplicitAllowed) {
    if (isBlockedHostname(normalized)) {
      throw new SsrFBlockedError(`Blocked hostname: ${hostname}`);
    }

    if (isPrivateIpAddress(normalized)) {
      throw new SsrFBlockedError("Blocked: private/internal/special-use IP address");
    }
  }

  const lookupFn = params.lookupFn ?? dnsLookup;
  const results = await lookupFn(normalized, { all: true });
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }

  if (!allowPrivateNetwork && !isExplicitAllowed) {
    for (const entry of results) {
      if (isPrivateIpAddress(entry.address)) {
        throw new SsrFBlockedError("Blocked: resolves to private/internal/special-use IP address");
      }
    }
  }

  const addresses = Array.from(new Set(results.map((entry) => entry.address)));
  if (addresses.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }

  return {
    hostname: normalized,
    addresses,
    lookup: createPinnedLookup({ hostname: normalized, addresses }),
  };
}

export async function resolvePinnedHostname(
  hostname: string,
  lookupFn: LookupFn = dnsLookup,
): Promise<PinnedHostname> {
  return await resolvePinnedHostnameWithPolicy(hostname, { lookupFn });
}

export function createPinnedDispatcher(pinned: PinnedHostname): Dispatcher {
  return new Agent({
    connect: {
      lookup: pinned.lookup,
    },
  });
}

export async function closeDispatcher(dispatcher?: Dispatcher | null): Promise<void> {
  if (!dispatcher) {
    return;
  }
  const candidate = dispatcher as { close?: () => Promise<void> | void; destroy?: () => void };
  try {
    if (typeof candidate.close === "function") {
      await candidate.close();
      return;
    }
    if (typeof candidate.destroy === "function") {
      candidate.destroy();
    }
  } catch {
    // ignore dispatcher cleanup errors
  }
}

export async function assertPublicHostname(
  hostname: string,
  lookupFn: LookupFn = dnsLookup,
): Promise<void> {
  await resolvePinnedHostname(hostname, lookupFn);
}
