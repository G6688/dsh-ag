# dsh-ag 安装说明（可以整份转发给别人）

把 **ag中转站** 接进 **DSH Desktop**。
**装好之后就再也没有开关命令**：插件在，模型就能用；把插件关掉，它自动撤干净。

- 你会拿到四样东西：`dsh-ag\`（插件本体）、`vendor\dsh-ag-1.0.0.tgz`（安装包）、
  `install.cmd` / `install.ps1`（一键安装脚本）。
- 插件**不保存密钥**，密钥始终待在你自己的 DSH 凭据库里（和别的供应商一样）。

## 一、前提

1. 这台机器上装有 **DSH Desktop**，能正常开会话。
2. 有自己的 **ag中转站账号和 API 密钥**（到 [ag中转站官网](https://agentrouter.org/) 申请；不要用别人的密钥）。
3. 网络能连到 ag中转站 的接口：
   - 能直连 → 把插件目录里 `cordis.patch.yml` 的 `proxy` 改成 `''`。
   - 不能直连（很多地方都不能）→ 需要本机有代理在跑，比如 Clash 常见的 `http://127.0.0.1:7890`，
     这也是插件里的默认值；端口不一样就改一下。

## 二、安装

> **如果感觉自己动手麻烦，可以让 agent 帮你安装这个插件。**
> 把上面这句话连同插件包（或仓库地址）一起丢给任意一个 coding agent（Codex / Claude Code / DSH
> 自带的 agent 都行），说一句「请把这个 DSH 插件装到我的 DSH Desktop 里」即可：它会自己解压、
> 跑脚本、核对结果。装完你只需要在「设置 → 模型」里填一次密钥。

插件要装进的是 DSH 的 **profile 目录**，默认是 `%USERPROFILE%\.dsh\profiles\desktop`。

### 方式 A：一键脚本（推荐）

1. 把压缩包解压到任意位置（例如桌面）。
2. 双击 `install.cmd`（它调用 PowerShell；**不需要管理员权限**，脚本只写你自己的用户目录）。
3. 看到 `完成` 后，**重启 DSH Desktop**。
4. 校验：随便打开一个会话，输入 `/ag`，能看到一段状态就说明装好了。

脚本按顺序做四件事：把插件目录复制到 profile 的 `node_modules\`、把安装包复制到 `vendor\`、
在 profile 的 `package.json` 里登记依赖并加入 `dsh.profile.bundles`、把 `pnpm-lock.yaml` 更新到和它
一致（这样 DSH 自带的插件市场之后还能正常装卸别的插件）。改过的文件都会先备份成
`<原名>.bak-<时间>`；同一个 profile 上重复运行不会重复登记，只会在有新版本时把插件换掉。
它**不碰** `settings.yaml`，也不读不写任何密钥。

脚本参数（一般用不到）：`-Profile <名字>` 装进别的 profile；`-DshHome <目录>` 换一个 DSH 主目录；
`-SkipLockFile` 不动 `pnpm-lock.yaml`。

### 方式 B：手动（和脚本等价）

设 profile 目录为 `%USERPROFILE%\.dsh\profiles\desktop`（脚本默认也是这个，非 desktop 的 profile
可以用 `install.ps1 -Profile <名字>`）。

1. 把 `dsh-ag` 整个目录复制成 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ag`。
2. 把 `vendor\dsh-ag-1.0.0.tgz` 复制到 `%USERPROFILE%\.dsh\profiles\desktop\vendor\`。
3. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：
   - `dependencies` 里加 `"dsh-ag": "file:vendor\\dsh-ag-1.0.0.tgz"`
     （JSON 里路径要写**两个反斜杠**）
   - `dsh.profile.bundles` 数组末尾加 `"dsh-ag"`（原来的项不要删）
4. 重启 DSH Desktop，输入 `/ag` 校验。

> 桌面版 profile 由应用自己管理，`dsh plugin --profile desktop add` 会被拒绝，所以走上面两条路。
> 自己建的 web / tui profile 可以用官方命令：`dsh plugin --profile <名字> add file:<插件目录绝对路径>`
> （路径前必须写 `file:`，否则会被当成 git 依赖）。

## 三、使用（不需要任何命令）

1. 打开 **设置 → 模型**，找到 **ag中转站** 卡片，点 **密钥**，粘贴你自己的 API 密钥并保存。
   只需要做这一次。
2. 在模型选择器里选 **`glm-5.3`** 或 **`deepseek-v4-flash`**，然后直接对话。
3. 想确认状态时可以输入 `/ag`：它会列出地址、模型、密钥是否配置、端点是否可达、代理装了没有。
   它只报告，不改动任何东西。

**开关就是插件本身**：

- 在插件面板里**关掉**这个插件（或者把它从 profile 的 `dsh.profile.bundles` 里删掉），它写进去的路由
  和它装的代理会一起撤掉，ag中转站的模型随之从选择器里消失。
- 再**打开**（把它加回 bundles），重启后自动接回来。
- 如果那个位置本来就有你自己写的一条 ag 路由，插件卸载时会把原来那条放回去。

> **名字说明**：包名和目录名是 `dsh-ag`（npm 包名只能用 ASCII 字母），状态命令是 `/ag`；
> 界面、文档和模型卡片里统一显示「ag中转站」。

## 四、遇到问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `/ag` 不存在 | 插件没加载：检查 `node_modules\dsh-ag` 目录名，以及 `package.json` 的 `bundles` 列表，然后重启。 |
| 模型列表里没有 ag中转站 | 同上；另外确认 profile 的 `package.json` 里两处都登记了。 |
| 报「API 密钥无效」 | 多半不是密钥：ag中转站只放行它认得的编程助手客户端，请求少了 `originator` 头会被 401 拒绝，界面就说成密钥无效。插件写入的路由总是带着这个头，所以先确认插件确实在挂载状态（`/ag`），再确认密钥粘贴的是自己的、没有多余空格。 |
| 端点不可达 / 连接超时 | 本机连不上该地址。把 `cordis.patch.yml` 的 `proxy` 改成你本机代理地址（例如 `http://127.0.0.1:7890`），或换一个能直连的地址并把 `proxy` 设为 `''`；改完重启。 |
| 402 Budget pool quota | 账号额度，不是配置问题。 |
| 想换地址 / 模型 | 改 `cordis.patch.yml` 的 `baseURL` / `proxy` / `models`，或在自己的 profile `cordis.patch.yml` 里按 id 覆盖，改完重启。 |

## 五、说明

- 插件用 `originator` 头让 ag中转站放行 DSH 这类客户端，**这属于绕过它的客户端限制**，请自行判断风险。
- 插件只是往 `llm-pi-ai` 设置段里写一条供应商路由，指向你的凭据名；它不读也不写密钥值。
- 想跑一遍自检（需要本机有 Node.js，可选）：`node test/plugin.test.mjs`，输出
  `all plugin tests passed` 即正常；全部离线执行，不会联网、不会动你的设置。

## 六、卸载

1. 先关掉插件（面板里关，或从 `dsh.profile.bundles` 里删掉）——这一步就会把路由和代理撤掉。
2. 删掉 `node_modules\dsh-ag` 目录，删掉 `vendor\` 里的 tgz。
3. 从 `package.json` 的 `dependencies` 里删掉 `dsh-ag`。
4. 重启 DSH Desktop。
