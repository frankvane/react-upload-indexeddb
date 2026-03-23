# 架构说明（含 Mermaid 详图）

本文是根 README 的架构补充，重点说明以下特色能力如何形成闭环：

## 文档职责

- 负责：系统模块关系、上传/下载链路、自动策略与续传机制的流程/时序说明。
- 不负责：组件逐项 Props 解释与 API 字段级契约字典。

- 自动检测网络状态
- 自动计算分片大小与并发
- 自动上传与自动清理
- IndexedDB 持久化存储
- 页面刷新后自动续传

## 1. 系统总览

```mermaid
flowchart TB
  subgraph FE["前端（React + Zustand + localforage）"]
    App["App 页面入口<br/>上传/下载/简化模式"]
    Net["网络状态检测<br/>online/offline/rtt/downlink"]
    Policy["自动策略引擎<br/>chunkSize + fileConcurrency + chunkConcurrency"]
    UploadCore["ZustandFileUpload（自动上传）"]
    DownloadCore["ZustandFileDownload"]
    SimpleMode["SimpleUploadList（简化模式）"]
    Cleanup["自动清理定时器<br/>autoCleanup + cleanupDelay"]
    UHook["Upload Hooks<br/>processor/uploader/cleanup"]
    DHook["Download Hooks<br/>files/downloader/storage"]
    UWorker["Upload Workers<br/>filePrepare/uploadWorker"]
    DWorker["Download Workers<br/>downloader/merger"]
    UploadIDB["IndexedDB<br/>上传队列/分片状态/设置快照"]
    DownloadIDB["IndexedDB<br/>下载分片/下载进度"]
  end

  subgraph BE["后端（Express + Sequelize + SQLite）"]
    API["/api/file/*"]
    UCtrl["uploadController"]
    DCtrl["downloadController"]
    DB["SQLite files/file_chunks"]
    FS["tmp/upload + uploads + download"]
  end

  App --> Net
  Net --> Policy
  Policy --> UploadCore
  App --> DownloadCore
  App --> SimpleMode
  SimpleMode --> UploadCore
  UploadCore --> UHook
  DownloadCore --> DHook
  UHook --> UWorker
  DHook --> DWorker
  UploadCore --> Cleanup
  UWorker <--> UploadIDB
  DWorker <--> DownloadIDB
  UWorker --> API
  DWorker --> API
  API --> UCtrl
  API --> DCtrl
  UCtrl --> DB
  UCtrl --> FS
  DCtrl --> DB
  DCtrl --> FS
```

## 2. 上传链路（完整/简化共享内核）

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant UI as 上传 UI（完整/简化）
  participant N as 网络状态检测
  participant P as 自动策略引擎
  participant FP as filePrepareWorker
  participant UW as uploadWorker
  participant IDB as IndexedDB
  participant API as /api/file/*
  participant UC as uploadController
  participant DB as SQLite
  participant FS as 文件系统

  U->>UI: 选择文件
  UI->>N: 采集当前网络状态
  N-->>P: online/rtt/downlink
  P-->>UI: 自动参数（分片大小 + 并发）
  UI->>FP: 读取文件 + hash + 分片信息
  FP-->>UI: 产出 UploadFile 队列
  UI->>UW: 自动开始上传（autoUpload=true）
  UW->>IDB: 写入上传队列与初始分片状态

  loop 每个文件
    UW->>API: POST /instant
    API->>UC: 秒传/分片校验
    UC->>DB: 查询 file_chunks/files
    UC-->>UW: 已上传 or 需补传分片

    alt 需要上传分片
      loop 每个缺失分片
        UW->>API: POST /upload
        API->>UC: 写入分片状态
        UC->>FS: 落盘 tmp 分片
        UC->>DB: 记录 chunk 元数据
        UW->>IDB: 持久化分片进度
      end
      UW->>API: POST /merge
      API->>UC: 合并并校验整文件
      UC->>FS: 合并到 uploads
      UC->>DB: upsert files + 更新 chunks 状态
    else 秒传
      UW-->>UI: skipped=true
    end

    UW-->>UI: onUploadComplete
    UI->>API: GET /list（刷新服务器清单）
  end

  UI->>UI: onBatchComplete
  Note over UI: autoCleanup=true 时自动清理；简化模式批次结束后关闭弹窗并清空本批次列表项

  opt 页面刷新后续传
    U->>UI: 刷新或重开页面
    UI->>IDB: 读取未完成队列/分片状态
    IDB-->>UI: 返回恢复上下文
    UI->>UW: 仅续传缺失分片
  end
```

### 上传链路关键点

- 自动策略与上传逻辑解耦：网络采样变化只影响策略参数，不破坏上传协议。
- `instant + upload + merge` 维持一致事务语义：先校验、再补传、最后合并校验。
- 上传进度持续写入 IndexedDB，保证刷新后可恢复而不是重传整文件。
- 自动清理在 UI 层执行，避免影响服务端文件清单与后续集成。

## 3. 下载链路

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant UI as 下载 UI
  participant DH as useDownloadFiles
  participant DW as downloader.worker
  participant API as /api/file/*
  participant DC as downloadController
  participant IDB as IndexedDB
  participant FS as 服务器文件系统

  U->>UI: 进入下载页
  UI->>DH: 初始化拉取列表
  DH->>API: GET /list
  API->>DC: 聚合 upload/download 目录文件
  DC->>FS: 扫描文件
  DC-->>DH: 文件清单（原始文件名优先）
  DH-->>UI: 展示列表

  U->>UI: 点击下载
  UI->>IDB: 查询历史下载进度
  alt 已有历史进度
    IDB-->>UI: 返回已完成分片
    UI->>DW: 从断点继续下载
  else 无历史进度
    UI->>DW: 创建新的分片下载任务
  end

  loop 分片下载
    DW->>API: GET /download/:id + Range
    API->>DC: 范围读取
    DC->>FS: 读取片段
    DC-->>DW: 返回分片数据
    DW->>IDB: 持久化分片与进度
  end

  alt 用户暂停或页面刷新
    UI->>IDB: 保留当前进度
  else 用户恢复
    UI->>IDB: 读取断点
    UI->>DW: 仅请求缺失分片
  end

  DW->>DW: 合并分片
  DW-->>UI: 完成并导出文件
```

### 下载链路关键点

- 下载使用 `Range` 请求，天然支持断点续传。
- 下载分片与进度写入 IndexedDB，暂停/刷新不会丢失上下文。
- 文件列表统一来自 `/api/file/list`，包含上传与下载目录聚合结果。

## 4. 自动策略决策流（上传）

```mermaid
flowchart TD
  Start["开始上传批次"] --> Detect["读取网络状态<br/>online/offline/rtt/downlink"]
  Detect --> Online{"是否在线"}
  Online -- 否 --> WaitNet["等待网络恢复并保留队列"]
  WaitNet --> Detect
  Online -- 是 --> Calc["计算自动参数<br/>chunkSize / fileConcurrency / chunkConcurrency"]
  Calc --> Validate["约束校验<br/>maxFileSize / maxFiles / maxRetries"]
  Validate --> Queue["写入上传队列到 IndexedDB"]
  Queue --> Upload["自动上传"]
  Upload --> Done{"文件完成?"}
  Done -- 否 --> Upload
  Done -- 是 --> Refresh["刷新服务端清单"]
  Refresh --> Cleanup{"autoCleanup?"}
  Cleanup -- 是 --> Timer["倒计时清理本地完成项"]
  Cleanup -- 否 --> Keep["保留完成项供人工处理"]
```

## 5. 简化模式与完整模式关系

```mermaid
flowchart LR
  Simple["简化模式 UI<br/>SimpleUploadList"] --> UploadCore["ZustandFileUpload 内核"]
  Full["完整上传模式 UI"] --> UploadCore
  UploadCore --> SharedHooks["共享 hooks/store/worker"]
  SharedHooks --> Auto["自动策略 + 自动清理 + IndexedDB 续传"]
  Auto --> API["/api/file/*"]
```

- 简化模式不维护第二套上传内核，只收敛 UI 操作复杂度。
- 完整模式保留参数调节和诊断能力；简化模式固定自动策略，适合集成页面。
