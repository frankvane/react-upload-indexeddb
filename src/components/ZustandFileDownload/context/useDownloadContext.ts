import { useContext } from "react";
import { DownloadContext, DownloadContextType } from "./DownloadContext";

export const useDownloadContext = (): DownloadContextType => {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error("useDownloadContext must be used within a DownloadProvider");
  }
  return context;
};
