import { describe, expect, it } from "vitest";
import { resolveNetworkStrategy } from "./networkStrategy";

describe("resolveNetworkStrategy", () => {
  it("marks network as offline when online=false", () => {
    const result = resolveNetworkStrategy({
      online: false,
      effectiveType: "4g",
      type: "wifi",
      rtt: 40,
    });

    expect(result.isNetworkOffline).toBe(true);
    expect(result.networkType).toBe("offline");
    expect(result.fileConcurrency).toBe(0);
    expect(result.chunkConcurrency).toBe(0);
    expect(result.chunkSize).toBe(512 * 1024);
  });

  it("uses low-latency profile for strong rtt", () => {
    const result = resolveNetworkStrategy({
      online: true,
      rtt: 45,
      effectiveType: "4g",
      type: "wifi",
    });

    expect(result.isNetworkOffline).toBe(false);
    expect(result.fileConcurrency).toBe(4);
    expect(result.chunkConcurrency).toBe(6);
    expect(result.chunkSize).toBe(8 * 1024 * 1024);
  });

  it("resolves wifi + 4g fallback profile", () => {
    const result = resolveNetworkStrategy({
      online: true,
      effectiveType: "4g",
      type: "wifi",
    });

    expect(result.networkType).toBe("4g");
    expect(result.fileConcurrency).toBe(3);
    expect(result.chunkConcurrency).toBe(4);
    expect(result.chunkSize).toBe(4 * 1024 * 1024);
  });

  it("applies conservative profile for 2g network", () => {
    const result = resolveNetworkStrategy({
      online: true,
      effectiveType: "2g",
      type: "cellular",
    });

    expect(result.fileConcurrency).toBe(1);
    expect(result.chunkConcurrency).toBe(1);
    expect(result.chunkSize).toBe(256 * 1024);
  });
});
