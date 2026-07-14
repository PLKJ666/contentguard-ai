# 后端开发备忘

> 本文件是早期备忘和待办记录。部分条目描述了当时尚未实现的 OSS/S3、转码或视频流能力；当前存储与上传行为以 `app/config.py`、上传 API、TOS 配置和测试为准。

## 文件预览相关 API

### 1. 文件上传与存储
- 达人上传脚本文件（支持 .docx, .pdf, .xlsx, .txt 等）
- 达人上传视频文件（支持 .mp4, .mov, .webm 等）
- 文件存储到 OSS/S3，返回访问 URL

### 2. 文件访问 API
```
GET /api/files/:fileId
返回：{ url: "文件访问URL", fileName, fileSize, fileType, uploadedAt }
```

### 3. 文件类型转换（可选，提升体验）
- Word (.docx) → PDF
- Excel (.xlsx) → PDF
- PPT (.pptx) → PDF
- 使用 LibreOffice 或 Pandoc 实现

### 4. 视频流服务
- 支持视频分段加载（Range 请求）
- 支持视频缩略图生成

---

## 审核相关 API

### 脚本审核
```
GET  /api/agency/review/scripts              # 待审脚本列表
GET  /api/agency/review/scripts/:id          # 脚本详情（含文件URL、AI分析结果）
POST /api/agency/review/scripts/:id/approve  # 通过
POST /api/agency/review/scripts/:id/reject   # 驳回
POST /api/agency/review/scripts/:id/force-pass # 强制通过
```

### 视频审核
```
GET  /api/agency/review/videos              # 待审视频列表
GET  /api/agency/review/videos/:id          # 视频详情（含文件URL、AI分析结果）
POST /api/agency/review/videos/:id/approve  # 通过
POST /api/agency/review/videos/:id/reject   # 驳回
POST /api/agency/review/videos/:id/force-pass # 强制通过
```

### 品牌方终审
```
GET  /api/brand/review/scripts              # 待终审脚本列表
GET  /api/brand/review/scripts/:id          # 脚本详情
POST /api/brand/review/scripts/:id/approve  # 终审通过
POST /api/brand/review/scripts/:id/reject   # 终审驳回

GET  /api/brand/review/videos               # 待终审视频列表
GET  /api/brand/review/videos/:id           # 视频详情
POST /api/brand/review/videos/:id/approve   # 终审通过
POST /api/brand/review/videos/:id/reject    # 终审驳回
```

---

## 申诉相关字段

审核列表和详情需要包含：
- `isAppeal: boolean` - 是否为申诉
- `appealReason: string` - 申诉理由
- `appealCount: number` - 第几次申诉

---

## 文件数据结构

```typescript
interface FileInfo {
  id: string
  fileName: string
  fileSize: string      // "1.5 MB"
  fileType: string      // "video/mp4", "application/pdf", etc.
  fileUrl: string       // 访问URL
  uploadedAt: string    // ISO 时间
  // 视频特有
  duration?: number     // 秒
  thumbnail?: string    // 缩略图URL
}
```

---

## 注意事项

1. 文件 URL 需要支持跨域访问（CORS）
2. 视频需要支持 Range 请求实现分段加载
3. 敏感文件考虑使用签名 URL（有效期限制）
