const trimSlash = (value: string) => value.replace(/\/+$/, "");

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").trim();

export const API_BASE_URL = rawBaseUrl ? trimSlash(rawBaseUrl) : "";

export const API_PATHS = {
  file: {
    instant: "/api/file/instant",
    status: "/api/file/status",
    upload: "/api/file/upload",
    merge: "/api/file/merge",
    list: "/api/file/list",
    download: "/api/file/download",
  },
};

export const buildApiUrl = (path: string) => `${API_BASE_URL}${path}`;
