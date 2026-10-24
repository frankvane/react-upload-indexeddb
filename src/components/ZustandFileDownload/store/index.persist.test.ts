import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDownloadStore } from "./index";

describe("download store persist（F2）", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it("持久化仅含用户偏好白名单字段且 version=1（F2 partialize）", () => {
    // 触发一次状态变更以触发 persist 写盘
    useDownloadStore.getState().setShowStorageStats(false);

    const raw = localStorage.getItem("download-network-storage");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(1);
    const persisted = parsed.state as Record<string, unknown>;

    // 白名单字段存在
    expect("displayMode" in persisted).toBe(true);
    expect("showProgress" in persisted).toBe(true);
    expect("showStorageStats" in persisted).toBe(true);
    expect("showNetworkStatus" in persisted).toBe(true);
    expect("showBatchInfo" in persisted).toBe(true);
    expect("maxRetries" in persisted).toBe(true);

    // 网络自适应 / 运行时派生字段不应被持久化
    expect("networkType" in persisted).toBe(false);
    expect("chunkSize" in persisted).toBe(false);
    expect("fileConcurrency" in persisted).toBe(false);
    expect("chunkConcurrency" in persisted).toBe(false);
    expect("isManuallySet" in persisted).toBe(false);
    expect("maxConcurrency" in persisted).toBe(false);
    expect("retryDelay" in persisted).toBe(false);
    expect("autoStart" in persisted).toBe(false);
  });

  it("迁移 v0 数据：剥离过期网络字段、保留用户偏好（F2 migrate）", async () => {
    // 构造旧版（version 0）持久化数据，含网络自适应 / 运行时字段
    localStorage.setItem(
      "download-network-storage",
      JSON.stringify({
        state: {
          networkType: "4G",
          chunkSize: 1048576,
          fileConcurrency: 3,
          chunkConcurrency: 3,
          isManuallySet: true,
          displayMode: "direct",
          maxConcurrency: 5,
          maxRetries: 3,
          retryDelay: 9999,
          autoStart: true,
          showProgress: true,
          showStorageStats: false,
          showNetworkStatus: true,
          showBatchInfo: true,
        },
        version: 0,
      })
    );

    vi.resetModules();
    const mod = (await import("./index")) as typeof import("./index");
    const freshStore = mod.useDownloadStore;
    // 同步 storage 通常为同步 rehydrate；稳妥起见等待一个 tick
    await new Promise((r) => setTimeout(r, 0));
    const state = freshStore.getState();

    // 偏好字段应保留
    expect(state.displayMode).toBe("direct");
    expect(state.showStorageStats).toBe(false);
    expect(state.maxRetries).toBe(3);

    // 过期网络 / 运行时字段应被剥离，回落到初始默认值（而非旧持久化值）
    expect(state.isManuallySet).toBe(false); // 初始默认 false，旧值 true → 证明被剥离
    expect(state.maxConcurrency).toBe(3); // 初始默认 3，旧值 5 → 证明被剥离
    expect(state.retryDelay).toBe(1000); // 初始默认 1000，旧值 9999 → 证明被剥离
  });
});
