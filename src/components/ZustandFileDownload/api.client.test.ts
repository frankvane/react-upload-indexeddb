import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, configureDownloadApi, getFileList } from "./api.client";

describe("configureDownloadApi 缺省保留现值（P2-29）", () => {
  beforeEach(() => {
    // 直接复位模块级状态，保证用例间隔离
    apiClient.defaults.baseURL = "";
    apiClient.defaults.withCredentials = false;
  });

  it("已开启 withCredentials 后，缺省调用不会将其重置", () => {
    configureDownloadApi({ withCredentials: true });
    expect(apiClient.defaults.withCredentials).toBe(true);

    // 模拟组件重复 mount（未传 withCredentials）
    configureDownloadApi({});

    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it("空 baseURL 不清空已有配置", () => {
    configureDownloadApi({ baseURL: "https://a.example.com" });
    expect(apiClient.defaults.baseURL).toBe("https://a.example.com");

    configureDownloadApi({ baseURL: "" });

    expect(apiClient.defaults.baseURL).toBe("https://a.example.com");
  });

  it("显式传入时正常覆盖", () => {
    configureDownloadApi({
      baseURL: "https://b.example.com",
      withCredentials: false,
    });

    expect(apiClient.defaults.baseURL).toBe("https://b.example.com");
    expect(apiClient.defaults.withCredentials).toBe(false);
  });
});

describe("getFileList 并发去重（#7）", () => {
  it("同一参数的并发调用只发一次 /api/file/list 请求", async () => {
    const spy = vi
      .spyOn(apiClient, "get")
      .mockImplementation(async () => ({
        data: { code: 200, data: { total: 0, files: [] } },
      }));

    // 同一 tick 内并发触发（模拟 StrictMode 下 effect 双调用 / 多入口同时刷新）
    const p1 = getFileList({});
    const p2 = getFileList({});
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    spy.mockRestore();
  });

  it("失败请求清除后不阻塞后续请求", async () => {
    const spy = vi
      .spyOn(apiClient, "get")
      .mockImplementation(async () => {
        throw new Error("boom");
      });

    await expect(getFileList({})).rejects.toThrow("boom");

    spy.mockImplementation(async () => ({
      data: { code: 200, data: { total: 0, files: [] } },
    }));
    const r = await getFileList({});

    expect(r.total).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
