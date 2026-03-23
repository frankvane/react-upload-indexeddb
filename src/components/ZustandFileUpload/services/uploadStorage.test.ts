import { describe, expect, it } from "vitest";
import { UploadStatus } from "../types/upload";
import { isUploadableStatus } from "./uploadStorage";

describe("isUploadableStatus", () => {
  it("returns true for resumable/interrupted statuses", () => {
    const resumableStatuses: UploadStatus[] = [
      UploadStatus.QUEUED,
      UploadStatus.QUEUED_FOR_UPLOAD,
      UploadStatus.CALCULATING,
      UploadStatus.PREPARING_UPLOAD,
      UploadStatus.UPLOADING,
      UploadStatus.PAUSED,
      UploadStatus.ERROR,
      UploadStatus.MERGE_ERROR,
    ];

    for (const status of resumableStatuses) {
      expect(isUploadableStatus(status)).toBe(true);
    }
  });

  it("returns false for completed statuses", () => {
    expect(isUploadableStatus(UploadStatus.DONE)).toBe(false);
    expect(isUploadableStatus(UploadStatus.INSTANT)).toBe(false);
  });
});
