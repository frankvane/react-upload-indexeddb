import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugLogger } from "./useDebugLogger";

describe("useDebugLogger", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => undefined);

  beforeEach(() => {
    logSpy.mockClear();
    clearSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records info log entries", () => {
    const { result } = renderHook(() => useDebugLogger());

    act(() => {
      result.current.logInfo("upload", "上传开始", { fileCount: 2 });
    });

    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0]?.level).toBe("info");
    expect(result.current.logs[0]?.category).toBe("upload");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("supports different levels and keeps append order", () => {
    const { result } = renderHook(() => useDebugLogger());

    act(() => {
      result.current.logSuccess("download", "下载成功");
      result.current.logWarning("network", "网络抖动");
      result.current.logError("system", "系统错误");
    });

    expect(result.current.logs).toHaveLength(3);
    expect(result.current.logs.map((item) => item.level)).toEqual([
      "success",
      "warning",
      "error",
    ]);
    expect(logSpy).toHaveBeenCalledTimes(3);
  });

  it("clears all logs", () => {
    const { result } = renderHook(() => useDebugLogger());

    act(() => {
      result.current.logInfo("storage", "写入存储");
      result.current.logInfo("storage", "再次写入");
    });
    expect(result.current.logs).toHaveLength(2);

    act(() => {
      result.current.clearLogs();
    });

    expect(result.current.logs).toHaveLength(0);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
