import { beforeEach, describe, expect, it } from "vitest";
import { apiClient, configureDownloadApi } from "./api.client";

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
