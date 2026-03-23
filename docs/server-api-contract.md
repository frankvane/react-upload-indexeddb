# Server API Contract (`/api/file/*`)

## 文档职责

- 负责：后端接口契约（路径、请求参数、响应结构、错误语义）。
- 不负责：前端页面交互步骤与组件接入教程。

## 1. 统一响应结构

所有接口统一返回：

```json
{
  "code": 200,
  "message": "ok",
  "data": {}
}
```

- `code=200` 表示业务成功
- 非 200 时返回 `{ code, message, data }`，并尽量附带可定位字段

## 2. 上传链路

### `POST /api/file/instant`

秒传检查 + 分片存在性校验。

请求体：

```json
{
  "file_id": "string",
  "md5": "string",
  "name": "string",
  "size": 12345,
  "chunk_md5s": ["md5-0", "md5-1"]
}
```

成功响应（已上传）：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "uploaded": true,
    "file": {}
  }
}
```

成功响应（未上传）：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "uploaded": false,
    "chunkCheckResult": [
      { "index": 0, "exist": true, "match": true }
    ]
  }
}
```

### `GET /api/file/status`

查询已上传分片索引。

Query：

- `file_id` 必填
- `md5` 必填（当前用于契约一致性校验）

响应：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "chunks": [0, 1, 2]
  }
}
```

### `POST /api/file/upload`

上传单个分片（`multipart/form-data`）。

字段：

- `file_id`
- `index`
- `chunk` (binary)
- `chunk_md5`（可选，但建议传）
- `user_id`（可选）

响应：

```json
{
  "code": 200,
  "message": "ok",
  "data": {}
}
```

### `POST /api/file/merge`

校验并合并分片，写入文件记录。

请求体：

```json
{
  "file_id": "string",
  "md5": "string",
  "name": "string",
  "size": 12345,
  "total": 8,
  "user_id": "test",
  "category_id": 1
}
```

关键行为：

- 校验分片存在性与 `chunk_md5`
- 合并后校验整文件 `md5`
- 自动写入 `files` / `file_chunks` 表
- 图片文件尝试生成缩略图（失败不阻断主链路）

## 3. 下载链路

### `GET /api/file/list`

查询可下载文件列表（聚合 `server/download` + `server/uploads`）。

Query：

- `search`（可选）

响应：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "total": 1,
    "files": [
      {
        "id": "7e34d731",
        "fileName": "sample-download.txt",
        "fileSize": 23,
        "fileType": "text/plain",
        "fileExt": "txt",
        "url": "/api/file/download/7e34d731",
        "thumbnailUrl": null,
        "createdAt": "2026-03-22T03:00:00.000Z",
        "md5": "7e34d731..."
      }
    ]
  }
}
```

### `GET /api/file/download/:file_id`

下载文件，支持 `Range` 断点续传。

关键响应头：

- `Accept-Ranges: bytes`
- `Content-Range`（206 时）
- `ETag`
- `Last-Modified`

错误约定：

- 文件不存在：`404`
- Range 非法：`416`

## 4. 错误码约定

- `400` 参数缺失/参数格式错误
- `404` 资源不存在
- `416` Range 不满足
- `500` 服务端异常
