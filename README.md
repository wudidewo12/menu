# Menu 菜单管理应用

一个基于 Next.js 的菜单与点餐应用。目前已经具备顾客菜单、购物车、菜品详情、后台管理、PostgreSQL 数据层和管理员账号认证，并正在逐步升级为更易维护的企业级项目。

> 当前处于渐进迁移阶段：菜单可在 JSON 与 PostgreSQL 两种读取模式之间切换；管理员账号、登录会话和角色权限已经使用 PostgreSQL。AI 菜单助手和生产部署仍属于后续阶段。

## 已有功能

- 浏览首页菜单和分类
- 查看菜品详情
- 添加购物车并保存点餐记录
- 后台新增、编辑、删除菜品
- 后台维护菜单分类和菜品顺序
- 上传和替换菜品图片
- 管理员账号登录、HttpOnly Cookie 会话和 OWNER/EDITOR/VIEWER 角色权限
- PostgreSQL + Prisma 菜单数据模型和事务写入
- 55 道菜品的初始化数据和本地图片
- TypeScript 类型检查和依赖安全审计

## 技术栈

- Next.js 15
- React 19
- Tailwind CSS 4
- TypeScript 5
- Node.js 轻量 JSON API
- PostgreSQL 17
- Prisma 7
- pnpm

## 本地运行

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备本地环境配置

先复制项目提供的安全模板：

```bash
cp .env.example .env.local
```

然后打开项目根目录的 `.env.local`，配置数据库连接和允许登录的网页来源。不要把真实值提交到 Git：

```env
APP_ORIGIN=http://127.0.0.1:3001
MENU_READ_SOURCE=json

POSTGRES_PORT=5434
POSTGRES_DB=menu_dev
POSTGRES_OWNER=menu_owner
POSTGRES_OWNER_PASSWORD=请设置数据库所有者密码
POSTGRES_APP_USER=menu_app
POSTGRES_APP_PASSWORD=请设置应用数据库密码
DATABASE_ADMIN_URL=请填写数据库维护连接
DATABASE_URL=请填写应用运行连接
```

`.env.local` 已被 Git 忽略，禁止把真实密码或 API Key 写入其他源码文件。

`APP_ORIGIN` 是唯一允许创建管理员登录会话的网站来源，协议、域名和端口必须与浏览器地址一致。本地开发启动器未读取到该配置时，会使用 `http://127.0.0.1:3001`；非本机地址必须使用 HTTPS。

后台不再使用共享的 `ADMIN_PASSWORD`。菜单保存和图片上传只能通过管理员账号登录会话，并由角色权限决定是否允许。

### 3. 启动项目

```bash
pnpm dev
```

启动完成后访问：

- 菜单首页：<http://127.0.0.1:3001>
- 后台管理：<http://127.0.0.1:3001/admin>

后台首次使用需要先创建 OWNER 管理员。相关命令会在终端中交互式询问信息，不会显示或保存明文密码：

```bash
pnpm auth:preview-owner
pnpm auth:commit-owner
```

忘记密码时使用：

```bash
pnpm auth:reset-password
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 构建并启动本地菜单和轻量后端 |
| `pnpm build` | 生成生产环境静态页面 |
| `pnpm start` | 使用已经生成的文件启动轻量后端 |
| `pnpm exec tsc --noEmit` | 运行 TypeScript 类型检查 |
| `pnpm audit --prod` | 检查生产依赖中的已知漏洞 |
| `pnpm auth:status` | 查看管理员账号和会话数量（不显示秘密） |
| `pnpm auth:reset-password` | 交互式重置管理员密码并撤销旧会话 |
| `pnpm db:status` | 查看本地 PostgreSQL 状态 |
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
├── prisma/                     # PostgreSQL/Prisma 数据模型和迁移
├── src/app/                    # Next.js 页面、组件和状态管理
│   ├── admin/                  # 后台管理页面
│   ├── context/                # 菜单和购物车状态
│   ├── data/                   # 初始菜品源数据
│   └── dish/                   # 菜品详情页面
├── src/types/                  # 菜品和菜单 TypeScript 类型
├── src/server/                 # 数据库、认证和服务端业务模块
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
- 正式服务缺少 `APP_ORIGIN` 时会拒绝启动。
- 菜单修改和图片上传只接受有效管理员会话，不接受共享密码请求头。
- 管理员密码只以 Argon2id 哈希保存；会话令牌只以哈希形式保存。
- `.env.local`、运行时数据和本机部署配置均被 Git 忽略。
- 不要在 Issue、截图、聊天记录或提交记录中公开密码和 API Key。
- `pnpm audit --prod` 应在升级依赖和发布前运行。

## 后续升级路线

1. 增加操作审计日志和菜单版本回滚。
2. 将订单数据迁移到 PostgreSQL，并将上传图片迁移到对象存储。
3. 接入 OpenAI API，让管理员用自然语言生成菜单修改草稿。
4. AI 修改必须经过结构校验、差异预览和人工确认后才能保存。
5. 增加完整自动化测试、持续集成、正式部署和监控。

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
