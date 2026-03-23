import { beforeEach, describe, expect, it } from "vitest";
import { useUploadStore } from "./upload";

describe("useUploadStore.initSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    useUploadStore.setState({
      autoUpload: true,
      autoCleanup: true,
      cleanupDelay: 10,
      networkDisplayMode: "tooltip",
    });
  });

  it("reads persisted values when settingsSource is localStorage", () => {
    localStorage.setItem("autoUpload", JSON.stringify(false));
    localStorage.setItem("autoCleanup", JSON.stringify(false));
    localStorage.setItem("cleanupDelay", JSON.stringify(22));
    localStorage.setItem("networkDisplayMode", "direct");

    useUploadStore.getState().initSettings({
      autoUpload: true,
      autoCleanup: true,
      cleanupDelay: 5,
      networkDisplayMode: "tooltip",
      settingsSource: "localStorage",
    });

    const state = useUploadStore.getState();
    expect(state.autoUpload).toBe(false);
    expect(state.autoCleanup).toBe(false);
    expect(state.cleanupDelay).toBe(22);
    expect(state.networkDisplayMode).toBe("direct");
  });

  it("uses provided defaults when settingsSource is props", () => {
    localStorage.setItem("autoUpload", JSON.stringify(false));
    localStorage.setItem("autoCleanup", JSON.stringify(false));
    localStorage.setItem("cleanupDelay", JSON.stringify(30));
    localStorage.setItem("networkDisplayMode", "direct");

    useUploadStore.getState().initSettings({
      autoUpload: true,
      autoCleanup: true,
      cleanupDelay: 5,
      networkDisplayMode: "tooltip",
      settingsSource: "props",
    });

    const state = useUploadStore.getState();
    expect(state.autoUpload).toBe(true);
    expect(state.autoCleanup).toBe(true);
    expect(state.cleanupDelay).toBe(5);
    expect(state.networkDisplayMode).toBe("tooltip");
  });
});
