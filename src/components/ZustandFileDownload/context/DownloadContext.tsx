import React, { createContext, useContext } from "react";

interface DownloadContextType {
  baseURL: string;
  listApi: string;
  downloadApi: string;
}

const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined
);

interface DownloadProviderProps extends DownloadContextType {
  children: React.ReactNode;
}

export const DownloadProvider: React.FC<DownloadProviderProps> = ({
  children,
  baseURL,
  listApi,
  downloadApi,
}) => {
  const value = {
    baseURL,
    listApi,
    downloadApi,
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownloadContext = () => {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error(
      "useDownloadContext must be used within a DownloadProvider"
    );
  }
  return context;
};
