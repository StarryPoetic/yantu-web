# 报告进度果冻素材

来自用户于 2026-11-12 提供的 640×640 MP4（圆球状透明果冻角色），保留原视频的弹跳、眨眼和表情。原文件不变、不上传，素材不生成新的角色或动作。

- 原视频 SHA-256：`aa1b162e57fe15f84f22e0fe081a08a996fc09ec1f6ff3395307a4885c7f675b`，2,628,851 字节，97 帧。
- 使用前 96 帧，24 fps / 4 秒循环；末尾重复停留帧省略。固定裁切区域为 `(64, 12, 544, 576)`，不逐帧重新居中。
- `public/media/jelly-progress-atlas.webp`：12×8 帧，单帧 170×180，总尺寸 2040×1440，带 alpha。CSS 以 24 fps 播放，失败、取消、结束及减少动画模式使用静态 poster。
- `public/media/jelly-progress-poster.webp`：首帧透明静态图。页面不加载原视频、抠图模型或音轨。
- 外轮廓抠图去除灰色背景、地面反光和画面边角文字，保留原角色内部高光和折射色彩；不声称从普通视频还原了物理透明材质。

## 本地复现

`scripts/prepare-jelly-video.py` 使用已有的 OpenCV、NumPy、ONNX Runtime，在本地处理视频，参数为原视频路径、`--model` 和 `--output`。它不会读取环境配置、下载模型或调用远程推理。

模型为 [rembg 的 U2netp](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py)，来自其公开 [v0.0.0 发布](https://github.com/danielgatis/rembg/releases/tag/v0.0.0)，MD5 `8e83ca70e441ab06c318d82300c84806`。320×320 推理后，保留最大前景区域、软化外轮廓，并用预乘 alpha 缩小，避免边缘混入原背景。

输出 RGBA PNG 帧后，用 FFmpeg 编码图集：

```text
ffmpeg -framerate 24 -i frames/frame-%03d.png -vf tile=12x8 -frames:v 1 -c:v libwebp -lossless 0 -quality 90 -compression_level 6 jelly-progress-atlas.webp
ffmpeg -i frames/frame-000.png -frames:v 1 -c:v libwebp -lossless 1 jelly-progress-poster.webp
```

本次 96 帧外边缘 alpha 均为 0，前景未碰到裁切边界。浏览器测试读取实际部署图集，检查全部帧透明边缘和前景存在，并验证桌面/手机、道路两端、阶段标签避让、减少动画及停止状态。角色位置继续由真实任务阶段控制，弹跳循环不冒充任务完成比例。
