# 照片上传格式修复

## API行为
POST /api/v1/attachments 支持 JPEG、PNG、静态WebP。Content-Type可为image/jpeg、image/jpg、image/png、image/webp。
允许声明类型与实际允许的图片编码不同，解决下载图片命名.jpg但实际为PNG/WebP的问题。
实际格式须由Pillow完整解码验证，保留4MiB、1600万像素与禁止动画限制。统一重新编码JPEG，移除EXIF/GPS，不提供原始外部文件链接。

## 幂等与错误
上传请求指纹保持原始内容摘要、老人、观察时间及说明，不以MIME作为身份条件。
旧失败请求可使用原幂等键重试；同一键重复成功返回原照片，不创建重复文件。
文件校验拒绝返回明确的中文safe_message与error_code，前端据此解除明确失败的本机锁定。未知结果仍须重试同一请求。

## 验收
23项照片/视觉/登录专项测试通过，包括WebP伪装JPEG、静态输出、幂等、坏文件不落盘、不支持格式和动画拒绝、权限及图片审核。无数据结构迁移。
