# Kinetic Oasis

一个无需构建工具的静态 PWA 页面示例，用于记录加油信息，并把最近一次记录保存到浏览器本地。

## 目录

```text
kinetic-oasis/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── styles.css
├── app.js
├── icons/
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## 本地运行

### 方式 1：直接打开

双击 `index.html` 即可预览页面。

### 方式 2：用本地静态服务器

在 PowerShell 里进入目录后执行：

```powershell
cd C:\Users\张无忌\kinetic-oasis
python -m http.server 5500
```

然后访问：

```text
http://localhost:5500
```

## 手机 PWA 测试

### Android

1. 把项目部署到 `https://` 地址，或先在电脑本地预览确认页面正常
2. 用 Chrome 打开页面
3. 等待浏览器识别 `manifest` 和 `service worker`
4. 在菜单中选择“安装应用”或“添加到主屏幕”

### iPhone

1. 用 Safari 打开部署后的页面
2. 点击分享按钮
3. 选择“添加到主屏幕”

### 本地局域网预览

先查看电脑局域网 IP：

```powershell
ipconfig
```

然后让手机和电脑连接同一 Wi-Fi，在手机里访问：

```text
http://你的电脑局域网IP:5500
```

这适合页面预览，但要完整验证“安装”与离线缓存，仍建议部署到 `https://`。

## 当前功能

- 输入加油量和单价后自动计算总支出
- 选择燃油类型
- 提交后保存到浏览器 `localStorage`
- 页面再次打开时自动回填最近一次保存的数据
- 支持清空本地记录
- 支持 `manifest`、主屏幕安装和离线缓存

## 部署方式

这是纯静态站点，可以直接部署到任意静态托管平台：

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

部署时上传整个 `kinetic-oasis` 目录即可，不需要额外打包。

## 说明

- 数据只保存在当前浏览器，不会上传到服务器
- 如果浏览器清除了站点数据或更换了设备，本地记录也会消失
- PWA 首次安装前必须先成功在线打开一次，浏览器才会缓存应用资源
