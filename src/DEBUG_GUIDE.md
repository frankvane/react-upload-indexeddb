# React 文件上传下载组件调试指南

## 🎯 概述

本项目提供了完整的文件上传下载组件调试示例，包含实时日志记录、调试面板和丰富的配置选项。

## 🚀 快速开始

### 启动项目
```bash
npm install
npm run dev
```

### 访问调试界面
打开浏览器访问 `http://localhost:5173`，您将看到：

1. **调试面板** - 实时显示所有操作日志
2. **文件上传标签** - 测试上传功能
3. **文件下载标签** - 测试下载功能

## 🐛 调试功能

### 调试面板特性
- **实时日志记录** - 自动记录所有上传下载操作
- **分类标签** - 按功能模块分类显示日志
- **日志级别** - 信息、成功、警告、错误四个级别
- **详细数据** - 可展开查看详细的调试数据
- **日志导出** - 支持导出 JSON 格式的日志文件
- **统计信息** - 显示各类型日志的数量统计

### 日志分类
- 🔵 **upload** - 文件上传相关日志
- 🟢 **download** - 文件下载相关日志
- 🟠 **network** - 网络状态相关日志
- 🟣 **storage** - 存储管理相关日志
- ⚫ **system** - 系统操作相关日志

### 日志级别
- ℹ️ **info** - 一般信息
- ✅ **success** - 成功操作
- ⚠️ **warning** - 警告信息
- ❌ **error** - 错误信息

## 📤 文件上传调试

### 配置选项
```tsx
<ZustandFileUpload
  baseURL="http://localhost:3000"
  uploadApi="/api/file/upload"
  checkApi="/api/file/instant"
  chunkSize={1024 * 1024} // 1MB
  fileConcurrency={2}
  chunkConcurrency={2}
  maxRetries={3}
  maxFileSize={100 * 1024 * 1024} // 100MB
  allowedFileTypes={[]} // 允许所有类型
  maxFiles={10}
  autoUpload={true}
  autoCleanup={true}
  cleanupDelay={5}
  networkDisplayMode="tooltip"
  // 回调事件
  onUploadStart={handleUploadStart}
  onUploadProgress={handleUploadProgress}
  onUploadComplete={handleUploadComplete}
  onUploadError={handleUploadError}
  onBatchComplete={handleUploadBatchComplete}
  customFileValidator={customFileValidator}
/>
```

### 调试要点
1. **文件验证** - 检查自定义验证器是否正常工作
2. **分片上传** - 观察大文件的分片处理过程
3. **进度监控** - 查看上传进度的实时更新
4. **错误处理** - 测试网络中断等异常情况
5. **秒传检测** - 验证相同文件的秒传功能

## 📥 文件下载调试

### 配置选项
```tsx
<ZustandFileDownload
  baseURL="http://localhost:3000"
  listApi="/api/files/list"
  downloadApi="/api/files/download"
  chunkSize={2 * 1024 * 1024} // 2MB 分片
  maxConcurrency={3} // 最大并发数
  maxRetries={5} // 最大重试次数
  retryDelay={2000} // 重试延迟 2 秒
  autoStart={false} // 手动开始下载
  showProgress={true} // 显示进度
  showStorageStats={true} // 显示存储统计
  showNetworkStatus={true} // 显示网络状态
  // 回调事件
  onDownloadStart={handleDownloadStart}
  onDownloadProgress={handleDownloadProgress}
  onDownloadComplete={handleDownloadComplete}
  onDownloadError={handleDownloadError}
  onBatchComplete={handleDownloadBatchComplete}
  onStorageChange={handleStorageChange}
/>
```

### 调试要点
1. **文件列表** - 检查 API 返回的文件列表格式
2. **分片下载** - 观察大文件的分片下载过程
3. **断点续传** - 测试下载中断后的恢复功能
4. **并发控制** - 验证并发下载数量限制
5. **存储监控** - 查看本地存储使用情况

## 🔧 调试技巧

### 1. 使用浏览器开发者工具
- **Network 标签** - 查看 HTTP 请求和响应
- **Application 标签** - 检查 IndexedDB 存储
- **Console 标签** - 查看详细的控制台日志

### 2. 调试面板操作
- **展开日志详情** - 点击日志条目查看详细数据
- **导出日志** - 保存调试日志用于分析
- **清空日志** - 重置调试环境

### 3. 模拟异常情况
- **网络中断** - 断开网络连接测试重试机制
- **大文件上传** - 测试分片和进度显示
- **存储限制** - 测试存储空间不足的处理

## 📊 性能监控

### 关键指标
- **上传/下载速度** - 监控传输速率
- **内存使用** - 观察大文件处理时的内存占用
- **错误率** - 统计失败操作的比例
- **重试次数** - 记录网络异常时的重试情况

### 优化建议
1. **调整分片大小** - 根据网络状况优化分片大小
2. **控制并发数** - 避免过多并发请求影响性能
3. **合理设置重试** - 平衡用户体验和服务器压力
4. **监控存储使用** - 及时清理不需要的文件

## 🛠️ 故障排除

### 常见问题
1. **上传失败** - 检查服务器 API 和文件大小限制
2. **下载中断** - 验证服务器是否支持 Range 请求
3. **进度不更新** - 确认回调函数是否正确绑定
4. **存储错误** - 检查浏览器存储权限和空间

### 解决方案
- 查看调试面板中的错误日志
- 检查浏览器控制台的详细错误信息
- 验证服务器 API 的响应格式
- 测试不同文件大小和类型

## 📝 日志分析

### 日志格式
```json
{
  "id": "1640995200000-abc123",
  "timestamp": "14:30:25",
  "level": "success",
  "category": "upload",
  "message": "文件 example.pdf 上传成功",
  "data": {
    "fileName": "example.pdf",
    "fileSize": 1048576
  }
}
```

### 分析要点
- **时间序列** - 按时间顺序分析操作流程
- **错误模式** - 识别重复出现的错误类型
- **性能瓶颈** - 找出耗时较长的操作
- **用户行为** - 分析用户的操作习惯

通过这个调试系统，您可以全面了解文件上传下载组件的运行状态，快速定位和解决问题。
