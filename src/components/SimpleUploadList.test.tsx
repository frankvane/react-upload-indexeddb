import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SimpleUploadList, { type SimpleServerFile } from "./SimpleUploadList";

const {
  mockGet,
  mockCreate,
  mockRemoveUploadFilesByIds,
  setUploadProps,
  getUploadProps,
} = vi.hoisted(() => {
  const getFn = vi.fn();
  const createFn = vi.fn();
  const removeFn = vi.fn();
  let uploadProps: Record<string, unknown> | null = null;

  return {
    mockGet: getFn,
    mockCreate: createFn,
    mockRemoveUploadFilesByIds: removeFn,
    setUploadProps: (props: Record<string, unknown>) => {
      uploadProps = props;
    },
    getUploadProps: () => uploadProps,
  };
});

vi.mock("axios", () => ({
  default: {
    create: mockCreate,
  },
}));

vi.mock("./ZustandFileUpload", () => ({
  default: (props: Record<string, unknown>) => {
    setUploadProps(props);
    return <div data-testid="upload-core-mock" />;
  },
}));

vi.mock("./ZustandFileUpload/services/uploadStorage", () => ({
  removeUploadFilesByIds: mockRemoveUploadFilesByIds,
}));

const createEnvelope = (files: SimpleServerFile[]) => ({
  data: {
    code: 200,
    message: "ok",
    data: {
      total: files.length,
      files,
    },
  },
});

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SimpleUploadList", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockReset();
    mockCreate.mockReturnValue({ get: mockGet });
    mockRemoveUploadFilesByIds.mockReset();
    mockRemoveUploadFilesByIds.mockResolvedValue(undefined);
  });

  it("loads server list on mount and emits latest list callback", async () => {
    const files: SimpleServerFile[] = [
      {
        id: "1",
        fileName: "demo.txt",
        fileSize: 128,
        fileType: "text/plain",
        createdAt: 1711000000000,
      },
    ];
    const onServerListChange = vi.fn();
    mockGet.mockResolvedValueOnce(createEnvelope(files));

    render(<SimpleUploadList onServerListChange={onServerListChange} />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onServerListChange).toHaveBeenCalledWith(files);
    });
  });

  it("serializes refresh requests and clears current batch list on batch complete", async () => {
    const firstFiles: SimpleServerFile[] = [
      {
        id: "a",
        fileName: "first.txt",
        fileSize: 256,
        fileType: "text/plain",
      },
    ];
    const secondFiles: SimpleServerFile[] = [
      {
        id: "b",
        fileName: "second.txt",
        fileSize: 512,
        fileType: "text/plain",
      },
    ];
    const thirdFiles: SimpleServerFile[] = [
      {
        id: "c",
        fileName: "third.txt",
        fileSize: 1024,
        fileType: "text/plain",
      },
    ];

    const deferredRefresh = createDeferred<ReturnType<typeof createEnvelope>>();
    const onServerListChange = vi.fn();

    mockGet
      .mockResolvedValueOnce(createEnvelope(firstFiles))
      .mockImplementationOnce(() => deferredRefresh.promise)
      .mockResolvedValueOnce(createEnvelope(thirdFiles));

    render(<SimpleUploadList onServerListChange={onServerListChange} />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /上传文件|upload/i }));

    await waitFor(() => {
      expect(screen.getByTestId("upload-core-mock")).toBeInTheDocument();
    });

    const uploadProps = getUploadProps();
    expect(uploadProps).not.toBeNull();

    act(() => {
      (uploadProps?.onUploadStart as ((files: Array<{ id: string }>) => void) | undefined)?.([
        { id: "mock-file" },
        { id: "mock-file-2" },
      ]);
      (uploadProps?.onUploadComplete as ((file: unknown, success: boolean) => void) | undefined)?.(
        { id: "mock-file" },
        true
      );
      (uploadProps?.onUploadComplete as ((file: unknown, success: boolean) => void) | undefined)?.(
        { id: "mock-file-2" },
        true
      );
    });

    expect(mockGet).toHaveBeenCalledTimes(2);

    deferredRefresh.resolve(createEnvelope(secondFiles));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(onServerListChange).toHaveBeenLastCalledWith(thirdFiles);
    });

    act(() => {
      (
        uploadProps?.onBatchComplete as
          | ((results: { success: number; failed: number; total: number }) => void)
          | undefined
      )?.({ success: 1, failed: 0, total: 1 });
    });

    await waitFor(() => {
      expect(mockRemoveUploadFilesByIds).toHaveBeenCalledWith([
        "mock-file",
        "mock-file-2",
      ]);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("upload-core-mock")).toBeNull();
    });
  });
});
