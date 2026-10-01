# 有理系数多项式实根隔离与符号区间分析后端

一个仅在 Windows 本地运行的后端：对**十二次以内**、系数为整数或分数字符串的
一元多项式，给出所有互不相同实根的**互不相交有理区间**、重数，以及“每个区间
恰含一根”的**精确证明依据**。没有网页，也不调用任何现成的符号代数/求根服务。

全部证据运算都基于自实现的 `BigInt` 有理数；小数只用于展示，从不参与判定。

## 算法与正确性

- `src/algebra/frac.ts`：任意精度有理数（BigInt 分子/分母，恒约分、分母恒正）。
- `src/algebra/poly.ts`：多项式四则、精确除法 `divmod`、欧几里得 GCD、导数。
- 平方自由分解（特征 0 的 Yun 投影），再用“因子整除原多项式的次数”**精确确定
  每个因子的重数**。因此偶重根（如 `(x-1)^2`、`x^2`）会出现在自己的平方自由
  因子里，**不会因采样不变号或浮点牛顿法而被漏掉**。
- `src/algebra/rational.ts`：有理根定理（先转整系数本原多项式，再枚举
  `p|a0, q|an`），在二分前把有理根（含端点根、零根、大分子/分母根）**精确析出**。
- `src/algebra/sturm.ts`：Sturm 序列与变号计数；端点采用单侧导数值（`V(a+)`、
  `V(b-)`），所以区间 `(a,b)` 计数天然排除恰为根的端点；用精确有理二分隔离。
- 证据字符串同时给出 Sturm 变号差为 1、两端点非根、两端符号、区间宽度与重数。
- **预算耗尽不声称找全**：未决区域进入 `unresolved`，并在结果中同时报告
  全实轴根数 `totalRealRoots` 与尚未隔离根数 `pendingCount`。

### 语义约定

- 零多项式：`isZeroPolynomial=true`，根数为 `null`（每个点都是根，不做有限计数）。
- 非零常数：0 个实根。
- 零项（缺失/`0` 系数）：规范化时剔除高位零，等价表达式收敛为同一条记录。
- 端点恰为根：精确求值识别为 `kind:"exact"`；开区间计根排除端点根。

## 依赖

- Node.js `>= 22.5`（开发与验证使用 Node v25），内置 `node:sqlite`
  （通过 `--experimental-sqlite` 启用，无需第三方数据库）。
  SQLite 数据库与 WAL 都写在本项目 `data/` 下。
- TypeScript 仅作类型检查；运行时用 Node 原生 TypeScript 直接执行（strip 模式）。

```powershell
npm install
```

## 测试

```powershell
npm test                 # 27 个测试：代数核心 + 持久化/事务 + HTTP 端到端
npm run typecheck
```

测试夹具（`src/generator.ts`，可复现）覆盖：无实根、重复（偶/奇重）根、相距
很近的根、零根、大分子分母根、端点根；并用“已知因式乘积”独立核对根数与重数，
同时验证缩放不变、Descartes 变号计数、细化包含关系、预算中断、事务回滚、
幂等重复提交以及重启后的持久化状态。时间/UUID 可通过注入的 `Clock` 固定。

## 启动与停止

只监听 `127.0.0.1`，端口传 `0` 时由操作系统自动分配空闲端口。

```powershell
# 前台（Ctrl+C 退出）
npm start

# 项目托管的后台方式（仅记录本项目 PID，停止只杀该进程）
npm run serve:managed
npm run stop

# 清理本项目运行数据（仅删除 ./data 与 ./tmp）
npm run clean

# 可重复的端到端演示（无随机性，输出确定）
npm run demo
```

## CLI

```powershell
node --experimental-sqlite src/main.ts help

# 建立多项式（系数为低次到高次，逗号分隔）
node --experimental-sqlite src/main.ts poly --coeffs "0,-3,4,-1"   # x(x-1)(x-3)

# 指定开区间计根（端点根单独标注，不计入内部）
node --experimental-sqlite src/main.ts count --id <PID> --a 0 --b 3

# 隔离 / 继续细化（细化总是新增版本，不覆盖旧结果；支持幂等键）
node --experimental-sqlite src/main.ts analyze --id <PID> --width 1/100000
node --experimental-sqlite src/main.ts refine  --id <PID> --width 1/10000000 --key k1

# 区间列表（分页）、未决区域、精确符号、版本比较、证明摘要导出
node --experimental-sqlite src/main.ts roots --analysis <AID> --limit 2 --offset 0
node --experimental-sqlite src/main.ts unresolved --analysis <AID>
node --experimental-sqlite src/main.ts sign-point --id <PID> --x 1/2
node --experimental-sqlite src/main.ts sign-interval --id <PID> --a 1 --b 2
node --experimental-sqlite src/main.ts compare --id <PID> --v1 1 --v2 2
node --experimental-sqlite src/main.ts proof --analysis <AID>
```

CLI 在写操作前后打印关键状态（已有版本数、全轴根数、已隔离/未决数量、证据）。

## HTTP API（均返回 JSON，错误带明确 `code`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/polynomials` | 建多项式，请求体 `{"coefficients":[...]}`，规范化去重 |
| `GET`  | `/polynomials?limit=&offset=` | 分页列出（1–200） |
| `GET`  | `/polynomials/:id` | 查询 |
| `GET`  | `/polynomials/:id/roots-count?a=&b=` | 开区间精确根数与端点根 |
| `POST` | `/polynomials/:id/analyses` | 隔离（`Idempotency-Key` 头实现幂等） |
| `POST` | `/polynomials/:id/refine` | 追加更细的新版本 |
| `GET`  | `/polynomials/:id/analyses` | 版本分页 |
| `GET`  | `/polynomials/:id/compare-versions?v1=&v2=` | 版本比较 |
| `GET`  | `/polynomials/:id/sign-point?x=` | 点处精确符号 |
| `GET`  | `/polynomials/:id/sign-interval?a=&b=` | 区间符号（含根则 `unknown`） |
| `GET`  | `/polynomials/:id/descartes` | 系数变号数（Descartes 上界） |
| `GET`  | `/analyses/:id` | 分析汇总（全轴根数/已隔离/未决） |
| `GET`  | `/analyses/:id/roots` | 区间分页 |
| `GET`  | `/analyses/:id/unresolved` | 未决区域 |
| `POST` | `/analyses/:id/proof-summary` | 导出精确证明摘要并持久化 |

错误码示例：`INVALID_POLYNOMIAL`、`INVALID_FRACTION`、`INVALID_WIDTH`、
`INVALID_BUDGET`、`INVALID_INTERVAL`、`INVALID_PAGINATION`、`INVALID_JSON`、
`POLYNOMIAL_NOT_FOUND`、`ANALYSIS_NOT_FOUND`、`VERSION_NOT_FOUND`、
`ZERO_POLYNOMIAL`、`NOT_FOUND`。

## 数据与迁移

Schema 在 `src/db/migrations.ts`，全部语句 `IF NOT EXISTS`，**迁移可重复执行**；
分析、根区间、未决区域与证明在同一事务提交，参数修订只追加版本，不覆盖旧数据。
所有数据、临时文件、PID 均位于项目内 `data/`、`tmp/`，脚本只管理本项目进程。
