# 德州扑克 · DSH Desktop 插件

独立安装、独立启停的 DeepSeek Harness 扩展。**这是社区自定义插件，并非 DeepSeek 官方插件。**

已验证环境：官方 **DSH Desktop 0.2.0-rc.2 / Windows x64**。其他系统尚未实机验证，升级 DSH 版本前请检查 peerDependencies 的兼容要求。

## 在另一台设备安装

1. 安装并打开对应版本的官方 DSH Desktop。
2. 打开左侧「插件」→ 安装，在包地址输入框粘贴：

```text
https://github.com/Star1ver-an/dsh-poker/releases/download/v0.1.0/dsh-local-poker-0.1.0.tgz
```

3. 安装并启用；如果提示重启，从「应用 → 退出」完全退出，再打开 DSH。左下角会出现「德州扑克」。

若设备不能直接下载 GitHub Release，可先从 [Releases](https://github.com/Star1ver-an/dsh-poker/releases/tag/v0.1.0) 下载 tgz，再把它的**本机绝对路径**粘贴到安装输入框。也支持从 GitHub 标签安装：

```text
github:Star1ver-an/dsh-poker#v0.1.0
```

仓库和安装包已包含构建后的 `lib/`，安装无需 Node.js 开发环境，也无需执行构建脚本。另一个插件见 [局域网好友聊天](https://github.com/Star1ver-an/dsh-lan-chat)，两者互不依赖。个人数据和服务地址不包含在仓库或安装包中。

## 使用

保留原扑克客户端的登录、二步验证、个人资料、头像、牌桌、操作和重连逻辑。

**本仓库不包含扑克服务器。** 首次打开「德州扑克」后填写自己的服务地址，例如 `https://your-server.example/poker`（必须含服务实际使用的路径前缀），保存后登录。服务须兼容原中转站的 `/account/*`、`/rooms/*` 和房间 WebSocket 接口。

- HTTP、头像和 WebSocket 经 DSH Host 桥接，兼容 Desktop 的独立页面来源。
- 地址保存在本机 `local_poker` 存储域；账号密码不保存，Cookie 仅保留在 Host 内存中。
- 停用或重启 DSH 后需要重新登录；修改服务前先退出账号。
- 需要站外浏览器 Cookie 的验证码方案尚未验证，浏览器现有登录不会自动导入 Desktop。
- `node scripts/mock-poker.mjs` 可启动只监听本机的只读测试服务；不会访问真实账号或执行金额操作，使用后需停止进程并清除测试地址。

在 DSH 插件管理器中可单独停用或卸载本插件。停用会清理该插件的界面贡献和连接，不删除已有个人数据。

## 开发和重新打包

源码在 `src/`，测试在 `tests/`，根目录的 `cordis.patch.yml` 是插件 bundle 入口。由官方 Host 提供的依赖声明为 peers，不在插件内安装另一份 Harness。

需要 Node.js 22+、pnpm，以及 0.2.0-rc.2 的官方 Desktop SDK：

```powershell
pnpm install --ignore-scripts --frozen-lockfile
node scripts/prepare-runtime.mjs
pnpm build
pnpm test
pnpm pack --pack-destination artifacts
```

`prepare-runtime.mjs` 默认只读解包 Windows 标准安装位置的 `resources/app.asar` 到被 Git 忽略的 `.runtime/`，不改官方应用。也可传入 `app.asar` 的绝对路径。若已有解包 SDK，可将环境变量 `DSH_RUNTIME` 设为其中的 `dsh/node_modules` 目录，供构建和测试共同使用。

依赖安装禁用自动补装 peers；运行时由 DSH 提供这些依赖。源码变化后重新构建，提交 `lib/`，重新打包并发布新版本。不要添加安装时自动编译的 prepare/postinstall 钩子。

## 验证与许可

独立仓库测试：15 项通过。原迁移已在官方 Desktop 实机验证独立启停、重启加载、本机测试服务的资料/头像/牌桌读取和 WebSocket 同步。真实服务地址、账号和真实牌局需由使用者的服务环境验证。

从原 DeepSeek Harness 项目的自定义功能拆出，来源基线 `c589d9761f`；目标 SDK 为官方 0.2.0-rc.2。采用 [MIT](LICENSE) 许可；原作者许可保留，打包依赖见 [第三方许可](THIRD_PARTY_NOTICES.txt)。
