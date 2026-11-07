import { afterEach, describe, expect, it, vi } from "vitest";

import { ChunkPersistenceService, hasStorageBudget } from "./chunkPersistenceService";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis.navigator ?? {},
  "storage"
);

const setStorageEstimate = (estimate?: { quota?: number; usage?: number }) => {
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: estimate
      ? { estimate: vi.fn().mockResolvedValue(estimate) }
      : undefined,
  });
};

describe("下载配额预检（P2-5）", () => {
  afterEach(() => {
    if (originalStorage) {
      Object.defineProperty(globalThis.navigator, "storage", originalStorage);
    } else {
      // 清理注入
      delete (globalThis.navigator as unknown as { storage?: unknown }).storage;
    }
  });

  it("配额充足 → 允许下载", async () => {
    setStorageEstimate({ quota: 1000, usage: 100 });
    await expect(hasStorageBudget(500)).resolves.toBe(true);
  });

  it("剩余空间不足 → 拒绝", async () => {
    setStorageEstimate({ quota: 1000, usage: 900 });
    await expect(hasStorageBudget(500)).resolves.toBe(false);
  });

  it("无法获取 estimate（旧浏览器 / 隐私模式）→ 放行，不阻断流程", async () => {
    setStorageEstimate(undefined);
    await expect(hasStorageBudget(1)).resolves.toBe(true);
  });

  it("estimate 抛错 → 放行", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      configurable: true,
      value: {
        estimate: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    await expect(hasStorageBudget(1)).resolves.toBe(true);
  });

  it("实例方法委托给同一判断", async () => {
    setStorageEstimate({ quota: 1000, usage: 950 });
    const service = new ChunkPersistenceService();
    await expect(service.hasStorageBudget(100)).resolves.toBe(false);
  });
});
