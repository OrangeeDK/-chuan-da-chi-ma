# 在 Render 部署截图推荐工具

当前仓库已包含 Dockerfile、识别依赖和线上服务入口。请选择 Web Service，不能选择 Static Site。

1. 登录 https://dashboard.render.com/ ，点击 New → Web Service。
2. 连接 GitHub，选择 OrangeeDK/-chuan-da-chi-ma 仓库。
3. 按以下配置创建服务：

| 设置 | 填写内容 |
| --- | --- |
| Name | clothing-size-helper（名称被占用时加一个后缀） |
| Branch | main |
| Region | Singapore（如果当前可选） |
| Language / Runtime | Docker |
| Root Directory | 留空 |
| Dockerfile Path | Dockerfile（默认） |
| Docker Command | 留空，使用仓库里的默认启动命令 |
| Instance Type | Free，先用于测试 |
| Health Check Path | /health（在 Advanced 中，如可选） |

4. 点击 Deploy Web Service，等待构建及启动结束。Docker 模式不需要手动填写 Python 安装命令或启动命令。
5. 显示 Live 后，打开平台分配的 https://...onrender.com 地址，上传尺码表并检查推荐。
6. 将实际网站地址提供给协作者，确认识别通过后，把 README 的“在线体验”链接换成这个地址。

也可使用 New → Blueprint 读取本仓库的 render.yaml，但首次手动创建 Web Service 更容易核对设置。

免费服务会在闲置后休眠，重新打开可能等待较久；它适合验证部署。OCR 在免费服务上的速度和内存是否够用，需要部署后实际检查。若出现内存不足或超时，先查看 Logs，再决定是否升级，不需要预先选择付费套餐。

线上页面和识别服务使用同一个地址，不需要 API 密钥、数据库或本地电脑运行。截图在服务内存中处理，不主动保存图片或身体信息；平台仍可能保留访问日志。当前线上入口不开放链接读取或登录测试，也不提供源码目录下载。

目前已完成部署配置与本机接口测试；Render 的 Linux 镜像构建、免费服务资源情况和公网访问仍待实际部署验证。

官方参考：https://render.com/docs/docker ，https://render.com/docs/free
