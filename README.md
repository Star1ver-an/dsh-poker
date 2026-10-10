# 德州扑克 · DSH Desktop 插件

独立安装、独立启停的 DeepSeek Harness 扩展。**这是社区自定义插件，并非 DeepSeek 官方插件。**

已验证环境：官方 **DSH Desktop 0.2.0-rc.2 / Windows x64**。其他系统尚未实机验证，升级 DSH 版本前请检查 peerDependencies 的兼容要求。

## 在另一台设备安装

1. 安装并打开对应版本的官方 DSH Desktop。
2. 打开左侧「插件」→ 安装，在包地址输入框粘贴：

```text
https://github.com/Star1ver-an/dsh-poker/releases/download/v0.2.2/dsh-local-poker-0.2.2.tgz
```

3. 安装并启用；如果提示重启，从「应用 → 退出」完全退出，再打开 DSH。左下角会出现「德州扑克」。

若设备不能直接下载 GitHub Release，可先从 [Releases](https://github.com/Star1ver-an/dsh-poker/releases/tag/v0.2.2) 下载 tgz，再把它的**本机绝对路径**粘贴到安装输入框。也支持从 GitHub 标签安装：

```text
github:Star1ver-an/dsh-poker#v0.2.2
```

仓库和安装包已包含构建后的 `lib/`，安装无需 Node.js 开发环境，也无需执行构建脚本。另一个插件见 [局域网好友聊天](https://github.com/Star1ver-an/dsh-lan-chat)，两者互不依赖。个人数据和服务地址不包含在仓库或安装包中。

## 本次余额刷新修复

买入或离桌返还确认完成后，自动重新读取中转站余额；再次打开牌桌也会刷新余额。读取失败时隐藏旧余额并提示重新打开，不会把已完成的返还变为待重试交易。

## 界面适配

修复牌桌阶段文字与自己的头像、座位重叠：阶段显示在底池旁，自己的座位采用横向布局。窗口顶部预留原生标题栏空间，避免 DSH 的最小化、最大化和关闭按钮遮挡牌桌；窄窗口也保留这段安全距离。

## 使用

保留原扑克客户端的登录、二步验证、个人资料、头像、牌桌、操作和重连逻辑。

**本仓库不包含扑克服务器。** 0.2.0 支持一台主机运行现有后端，其他设备在局域网中搜索并连接。

### 主机（只配置一次）

1. 保持原扑克后端与中转站运行。
2. 「德州扑克 → 连接设置 → 手动输入地址」填写已验证的本机入口，例如 `http://127.0.0.1:8090/poker`。直连后端时可以不含 `/poker`，但该入口的 Origin 必须在后端允许列表中。
3. 点击「允许局域网发现本机服务」。插件自动提供局域网入口，主机无需修改 Docker 映射或为每台客户端配置后端 Origin。
4. 在系统防火墙允许 DSH 访问局域网。主机需要一直运行 DSH、插件和后端。

共享设置随 DSH 重启恢复。发现使用 IPv4 UDP 41889；共享入口默认 TCP 41890（Host 配置 `sharePort` 可修改），只转发扑克的账户、头像和房间接口。它保留每个客户端自己的会话 Cookie，并使用本地后端的 Origin；不会分享主机登录凭证。共享入口使用局域网 HTTP，适用于可信的私人局域网，不用于公网部署。停止共享或停用插件会关闭入口并断开连接；不会自动退出后端中的牌局或返还筹码。

### 其他设备

1. 安装本页的插件；首次打开会自动搜索。
2. 在发现列表点击主机的「连接」，再登录自己的中转站账号。
3. 连接地址会保存在当前设备。再次打开无需重新填写，DSH 重启后重新登录即可。

其他设备无需安装 Docker、数据库、旧版 DSH Web，也不需要开启共享。广播不会跨路由器、访客 Wi-Fi 隔离或部分 VPN；无法发现时，可在主机「连接设置」查看共享地址，在客户端手动填写。主机 IP 变更后重新搜索连接。

### 小窗口界面

登录时集中显示服务选择与表单；入座后按窗口宽高压缩牌桌。关闭按钮保留在顶部，内容区可滚动，窄窗口的操作区吸附底部；服务设置与牌局动态默认折叠。

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

0.2.0 的测试覆盖局域网发现、取消与报文校验、HTTP/WebSocket 转发、Cookie 隔离、连接生命周期。已在官方 Desktop 检查宽窗口与半屏牌局、登录和连接设置；已从独立 Docker 网络向 Windows 主机发送发现请求并读取真实后端配置。未使用真实账号下注，也未进行第二台物理设备的实测。

从原 DeepSeek Harness 项目的自定义功能拆出，来源基线 `c589d9761f`；目标 SDK 为官方 0.2.0-rc.2。采用 [MIT](LICENSE) 许可；原作者许可保留，打包依赖见 [第三方许可](THIRD_PARTY_NOTICES.txt)。
