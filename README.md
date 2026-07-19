# Menu 菜单管理应用

一个基于 Next.js 的菜单与点餐应用。目前已经具备顾客菜单、购物车、菜品详情和轻量后台管理能力，并正在逐步升级为更易维护的企业级项目。

> 当前后端使用本地 JSON 文件保存数据，适合开发、学习和小规模部署。数据库、完整账号体系和 AI 菜单助手仍属于后续规划，尚未接入生产环境。

## 已有功能

- 浏览首页菜单和分类
- 查看菜品详情
- 添加购物车并保存点餐记录
- 后台新增、编辑、删除菜品
- 后台维护菜单分类和菜品顺序
- 上传和替换菜品图片
- 使用管理员密码保护菜单修改接口
- 55 道菜品的初始化数据和本地图片
- TypeScript 类型检查和依赖安全审计

## 技术栈

- Next.js 15
- React 19
- Tailwind CSS 4
- TypeScript 5
- Node.js 轻量 JSON API
- pnpm

## 本地运行

### 1. 安装依赖

```bash
pnpm install
```

### 2. 设置本地管理员密码

在项目根目录创建 `.env.local`：

```env
ADMIN_PASSWORD=请替换成随机强密码
```

可以使用 Node.js 生成一条 32 位随机密码：

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

`.env.local` 已被 Git 忽略，禁止把真实密码或 API Key 写入其他源码文件。

如果本地没有设置 `ADMIN_PASSWORD`，开发启动器会为本次运行自动生成一个临时密码，并显示在本机终端中。

### 3. 启动项目

```bash
pnpm dev
```

启动完成后访问：

- 菜单首页：<http://localhost:3001>
- 后台管理：<http://localhost:3001/admin>

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 构建并启动本地菜单和轻量后端 |
| `pnpm build` | 生成生产环境静态页面 |
| `pnpm start` | 使用已经生成的文件启动轻量后端 |
| `pnpm exec tsc --noEmit` | 运行 TypeScript 类型检查 |
| `pnpm audit --prod` | 检查生产依赖中的已知漏洞 |
| `pnpm image:review` | 生成菜品图片审核数据 |

## 页面地址

| 地址 | 作用 |
| --- | --- |
| `/` | 菜单首页 |
| `/dish/[id]` | 菜品详情 |
| `/cart` | 购物车和点餐页面 |
| `/admin` | 菜单后台管理 |

## 项目结构

```text
menu/
├── data/                       # 菜单种子和运行时数据目录
├── public/images/dishes/       # 正式菜品图片
├── src/app/                    # Next.js 页面、组件和状态管理
│   ├── admin/                  # 后台管理页面
│   ├── context/                # 菜单和购物车状态
│   ├── data/                   # 初始菜品源数据
│   └── dish/                   # 菜品详情页面
├── src/types/                  # 菜品和菜单 TypeScript 类型
├── tools/                      # 菜单同步、开发启动和图片工具
├── server.js                   # 静态页面服务器和轻量 JSON API
├── package.json                # 命令与依赖配置
└── tsconfig.json               # TypeScript 配置
```

## 数据说明

- `data/menu-seed.json` 是可以提交到 Git 的初始菜单。
- `data/menu.json` 是后台保存后的运行时菜单，不提交到 Git。
- `data/orders/` 保存运行时订单，不提交到 Git。
- `data/uploads/` 保存后台上传的图片，不提交到 Git。

这样部署新版本时，程序代码和运行中的菜单数据可以分开维护。

## 安全说明

- 项目不提供公开的默认管理员密码。
- 正式服务缺少 `ADMIN_PASSWORD` 时会拒绝启动。
- `.env.local`、运行时数据和本机部署配置均被 Git 忽略。
- 不要在 Issue、截图、聊天记录或提交记录中公开密码和 API Key。
- `pnpm audit --prod` 应在升级依赖和发布前运行。

## 后续升级路线

1. 继续把关键 JavaScript 文件逐步迁移到 TypeScript。
2. 将 JSON 文件存储升级为 PostgreSQL 数据库。
3. 建立正式的管理员账号、登录、权限和操作日志。
4. 拆分菜单、菜品、图片和订单 API。
5. 接入 OpenAI API，让管理员用自然语言生成菜单修改草稿。
6. AI 修改必须经过结构校验、差异预览和人工确认后才能保存。
7. 增加自动化测试、持续集成和正式部署流程。

## AI 功能边界

未来的 AI 菜单助手不会直接操作数据库。推荐流程是：

```text
管理员描述需求
→ AI 生成结构化修改草稿
→ 服务端校验菜品和菜单字段
→ 后台显示修改前后差异
→ 管理员确认
→ 保存菜单并记录操作日志
```

这种设计可以避免 AI 因理解错误而直接破坏正式菜单。
