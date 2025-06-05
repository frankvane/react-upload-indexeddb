import { useCallback } from "react";

/**
 * 断点续传支持检测钩子
 *
 * 用于检测服务器是否支持断点续传
 */
const useResumeSupport = () => {
  /**
   * 检查URL是否支持断点续传
   *
   * @param url 要检查的URL
   * @returns 是否支持断点续传
   */
  const checkResumeSupport = useCallback(
    async (url: string): Promise<boolean> => {
      try {
        // 发送HEAD请求检查服务器响应头
        const response = await fetch(url, { method: "HEAD" });

        // 检查Accept-Ranges头
        const acceptRanges = response.headers.get("accept-ranges");
        if (acceptRanges && acceptRanges !== "none") {
          return true;
        }

        // 有些服务器不返回Accept-Ranges但支持Range
        const contentLength = response.headers.get("content-length");
        if (!contentLength) {
          return false;
        }

        // 尝试请求一个字节范围
        const rangeResponse = await fetch(url, {
          headers: { Range: "bytes=0-0" },
        });

        // 如果返回206 Partial Content，说明支持断点续传
        return rangeResponse.status === 206;
      } catch (error) {
        console.error("Error checking resume support:", error);
        return false;
      }
    },
    []
  );

  /**
   * 获取文件大小和其他元数据
   *
   * @param url 文件URL
   * @returns 文件元数据对象
   */
  const getFileMetadata = useCallback(async (url: string) => {
    try {
      const response = await fetch(url, { method: "HEAD" });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch metadata: ${response.status} ${response.statusText}`
        );
      }

      // 获取文件大小
      const contentLength = response.headers.get("content-length");
      const fileSize = contentLength ? parseInt(contentLength, 10) : undefined;

      // 获取内容类型
      const contentType = response.headers.get("content-type");

      // 获取ETag和Last-Modified
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");

      // 检查断点续传支持
      const acceptRanges = response.headers.get("accept-ranges");
      const resumeSupported = acceptRanges && acceptRanges !== "none";

      return {
        fileSize,
        contentType,
        etag,
        lastModified,
        resumeSupported,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error) {
      console.error("Error fetching file metadata:", error);
      return {
        fileSize: undefined,
        contentType: undefined,
        etag: undefined,
        lastModified: undefined,
        resumeSupported: false,
        headers: {},
      };
    }
  }, []);

  return {
    checkResumeSupport,
    getFileMetadata,
  };
};

export default useResumeSupport;
