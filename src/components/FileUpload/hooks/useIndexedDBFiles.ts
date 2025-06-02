import { useCallback, useState } from "react";

import { UploadFile } from "../types/upload";
import localforage from "localforage";

export function useIndexedDBFiles() {
  const [files, setFiles] = useState<UploadFile[]>([]);

  const refresh = useCallback(async () => {
    const result: UploadFile[] = [];
    await localforage.iterate<UploadFile, void>((value) => {
      if (value) result.push(value);
    });
    setFiles(result);
  }, []);

  return { files, refresh };
}
