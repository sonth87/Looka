# Kế hoạch phân tầng backend `apps/api` theo "Đặc tả phân tầng ứng dụng" (bản NestJS)

> **Trạng thái:** BẢN THẢO để trao đổi — chưa phải implementation plan, chưa
> code. Ngày lập: 2026-09-11. Người đọc: product owner + người viết backend.
>
> **Nguồn:** "Đặc tả phân tầng ứng dụng" (Đỗ Đăng Khoa, chia sẻ qua
> visually.iai.vn ngày 11/09/2026, 17 mục, 6 tầng · 6 ranh giới · 5 behavior ·
> 10 điều cấm). Tài liệu gốc viết cho một cổng thanh toán .NET (EF Core,
> MediatR, PostgreSQL, Redis, connector ngân hàng). Tài liệu này **dịch** nó
> sang NestJS + TypeORM cho `Looka/apps/api`, đối chiếu với code hiện tại,
> nêu cấu trúc thư mục đích và lộ trình chuyển đổi. Đoạn nào của spec không
> hợp với NestJS hoặc với bài toán của Looka thì bỏ qua và ghi rõ ở §5.
>
> **Đã chốt 2026-09-11 (4 quyết định nền):**
> - **Q1 — Tách host:** một codebase, ba root module
>   (`AppCommandModule` / `AppQueryModule` / `AppWorkerModule`), `main.ts`
>   chọn theo `SERVICE_TYPE=command|query|worker|all`. Dev chạy `all`.
> - **Q2 — Bus:** dùng `@nestjs/cqrs` (`CommandBus` / `QueryBus`), đúng
>   house style của `dynaform-service`.
> - **Q3 — Tầng miền:** aggregate riêng (`domain/aggregate/*.aggregate.ts`
>   kế thừa `AggregateRoot`, trả `Result`), TypeORM entity ở
>   `infrastructure/persistence`, repository làm mapper hai chiều.
> - **Q4 — Lộ trình:** tăng dần. Giai đoạn 0 dựng nền không đổi hành vi,
>   sau đó chuyển từng module theo rủi ro thấp → cao. Module mới viết theo
>   cấu trúc mới ngay.
>
> **Đã chốt 2026-09-11, vòng 2 (chi tiết ở §7):** Q5 audit row
> `device_events` commit riêng trước khi xử lý; Q6 dedup batch theo
> `batchId`; Q7 query chỉ đọc qua read repository; Q9 `photo-review` đọc
> `capture` qua `QueryBus`; Q10 tách `campaign` + `device`; Q11 tách
> `identity`; Q12 giữ ba bảng outbox, gộp worker.
>
> **Chưa chốt:** thứ tự thực hiện so với `cms-8-screens-api-plan.md`.
> Người dùng nói rõ: *hiện tại chỉ cần lên plan, chưa code* — thứ tự sẽ
> quyết khi bắt đầu. Tài liệu này vẫn là bản thảo thảo luận, không phải
> lệnh bắt đầu.
>
> **Vòng 3 — cải thiện cấu trúc, cùng ngày (Q14–Q21, chi tiết ở §7):**
> `packages/api-contract` sinh từ Swagger + mã lỗi tay; `presentation/`
> tách `kiosk/` và `cms/`; ba jest project unit / integration / e2e;
> camelCase trong TS, snake_case chỉ ở DB; bảng `background_jobs` generic
> cho việc nền không phải upload; đơn tenant; module `audit` ghi từ domain
> event; module `reporting` chỉ đọc, tính lúc đọc.
>
> Nguồn đối chiếu code: `apps/api/src` (3 module nghiệp vụ, 17 entity, 27
> migration, 14 spec, 1 e2e), `apps/api/package.json`, `eslint.config.mjs`;
> mẫu house style: `D:\Work\dynaform-service\src` (`app-command.module.ts`,
> `shared/domain/*`, `modules/form-instance/*`).

---

## 0. Tóm tắt

**Spec nói gì.** Có hai đồ thị khác nhau: chiều *gọi* lúc chạy (Host → Điều
phối → Miền → Cổng ra → Kho) và chiều *phụ thuộc* lúc biên dịch (Miền và
Common không tham chiếu gì; mọi thứ khác trỏ xuống chúng). Sáu ranh giới,
mỗi ranh giới một kiểu dữ liệu đi qua; entity ORM không ra khỏi tầng điều
phối, `IQueryable` không ra khỏi tầng bền vững, bí mật đã giải mã không ra
khỏi lượt gọi. Pipeline một lệnh có 5 bước (log → validate → idempotency →
transaction → handler → dispatch sự kiện miền trước commit). Bốn thứ phải có
trước handler nghiệp vụ đầu tiên: `IUnitOfWork` (repository **cấm** tự
commit), `TransactionBehavior`, sự kiện miền trên aggregate, hợp đồng
idempotency. Lỗi được dịch **đúng một bậc** ở mỗi tầng. Luật phụ thuộc được
ép bằng test tự động chạy cùng CI.

**Hiện trạng `apps/api` (bằng chứng ở §2).** Kiến trúc thực tế là
controller → service → `Repository<T>` hoặc raw SQL. Không CQRS, không tầng
miền (17 entity đều anemic, 0 method), không unit-of-work (33 lần `.save()`
rải rác, `dataSource.transaction()` ở 18 chỗ trong service), ba bảng outbox +
ba worker copy-paste, lỗi ràng buộc Postgres xử lý bằng ba bản
`'23505'` riêng lẻ và không đọc tên constraint, hai exception filter chồng
nhau (422 và 500 cho cùng một lỗi), không cổng lint/arch test, một process
chạy cả HTTP đọc + ghi + 4 cron, `common/` chứa bảng mã lỗi của mọi module và
guard SSO tự ghi bảng `users`.

**Kết quả của tài liệu này.** Bảng dịch khái niệm .NET → NestJS (§1), bảng
khoảng cách có mức ⛔/⚠ (§2), cấu trúc thư mục đích (§3), quy ước từng tầng
bản Looka (§4), phần bỏ qua (§5), lộ trình 6 giai đoạn (§6), câu hỏi mở
Q5–Q12 (§7), mười điều cấm và cổng CI bản Looka (§8, §9).

---

## 1. Bảng dịch khái niệm: spec (.NET) → `apps/api` (NestJS)

| Spec | Trong `apps/api` sau chuyển đổi | Ghi chú |
|---|---|---|
| `CommandApi` · `QueryApi` · `Workers` (3 deployable) | `app-command.module.ts` · `app-query.module.ts` · `app-worker.module.ts`; `main.ts` đọc `SERVICE_TYPE` | Mỗi module nghiệp vụ export ba sub-module `XCommandModule` / `XQueryModule` / `XWorkerModule` để root module nhặt đúng phần (§4.1) |
| `IMediator.Send(IRequest<T>)` | `CommandBus.execute()` / `QueryBus.execute()` của `@nestjs/cqrs` | Controller chỉ được gọi bus |
| `Commands/ · Handlers/ · Validates/ · Mappings/ · TransferModels/` | `application/commands/{command,handler,transfer-model,mapper}` | Validate hình thức = `class-validator` trên transfer-model + `ValidationPipe` (đã có); luật ứng dụng nằm trong handler; luật trong một aggregate nằm ở aggregate |
| `Queries/ · ReadModels/ · FilterModels/` | `application/queries/{query,handler,read-model,filter-model}` | Đổi tên `dao/` hiện tại (thực chất là response DTO) thành `read-model` |
| `Behaviors/` (MediatR pipeline) | `@nestjs/cqrs` **không có** pipeline. Thay bằng: ① `LoggingInterceptor` + correlation id (AsyncLocalStorage) ở host; ② `ValidationPipe`; ③ idempotency — xem §5; ④ `UnitOfWork.run()` do base class `TransactionalCommandHandler` gọi; ⑤ `DomainEventDispatcher` chạy trong `UnitOfWork` trước commit | Không dùng `EventBus` của `@nestjs/cqrs` cho bước ⑤ vì nó fire-and-forget, không await được trước commit |
| `Domains/Entities/<BC>/ · ValueObject/ · Result<T>` | `modules/<m>/domain/{aggregate,value-object,event,enum}` + `shared/domain/{aggregate-root,domain-event,value-object,result}` | `Result<T>` mới (dynaform chưa có); aggregate **không import** `typeorm`, `@nestjs/*`, `shared/database`, `shared/integrations` |
| `Infrastructures/DbContext · Persistence/Configuration · Repositories · UnitOfWork` | `modules/<m>/infrastructure/{persistence,repositories,read}` + `shared/database/{unit-of-work,transaction-context,constraint-error.translator,advisory-lock}` | "Một tệp một bảng" = một `*.entity.ts` + một `*.mapper.ts`; repository **không** gọi `dataSource.transaction()` |
| `ThirdServices` + `ThirdServices.<Bank>` | `application/ports/*.port.ts` (interface) + `shared/integrations/{file-service,python-ai,sso,dainam-student}/*.adapter.ts` | "Ngân hàng" của Looka là fs-core, sidecar Python, SSO trường, API sinh viên Dai Nam. Adapter **không biết** campaign / session / tenant là gì ngoài tham số nhận vào |
| `PartnerCallResult · PartnerCallOutcome` | `IntegrationOutcome` (`Success · Retryable · Terminal · Timeout · Unavailable`) trả từ adapter | Ánh xạ từ `FsError.retryable` hiện có; **không** trả HTTP status ra khỏi adapter |
| `Common/` | `src/shared/` (gộp `src/common/` + `src/modules/shared/common/`) | `shared/` không chứa mã lỗi nghiệp vụ của module, không chứa guard tự ghi DB |
| `PostgresException.ConstraintName` | `QueryFailedError.driverError.code` + `.constraint` (driver `pg`) | Dịch tập trung ở `shared/database/constraint-error.translator.ts`, bảng ánh xạ do từng module khai báo |
| Advisory lock cho worker (§8.3) | `pg_try_advisory_xact_lock(hash(name))` trong `shared/database/advisory-lock.service.ts`; giữ `FOR UPDATE SKIP LOCKED` cho claim hàng đợi | Xem §4.6 |
| `IRedisHandling` | **Bỏ** — Looka không có Redis | §5 |
| `Tests/ArchitectureRuleTests.cs` | `eslint-plugin-boundaries` (hoặc `no-restricted-imports`) + một jest test đọc đồ thị import bằng `dependency-cruiser` | §9 |
| `BaseApiResponse` · `ExceptionHandlingMiddleware` | Một envelope thống nhất `{ statusCode, message, data }` cho cả thành công và lỗi (thêm `errorCode`, `correlationId`), **một** global filter | Hiện có hai shape khác nhau và hai filter chồng nhau |
| `Sql/07-roles.sql` vai `payment_runtime` | Vai `looka_app` không sở hữu bảng, chỉ `SELECT/INSERT/UPDATE` (+ `DELETE` trên outbox) | Không thuộc cấu trúc thư mục; ghi ở §6 giai đoạn 5 |

---

## 2. Hiện trạng đối chiếu spec — bảng khoảng cách

Đánh dấu như spec §14: ⛔ phải sửa trước hoặc trong lúc viết handler đầu tiên
theo cấu trúc mới; ⚠ sửa trong lộ trình.

| # | Hiện trạng (bằng chứng) | Spec nói | Mức |
|---|---|---|---|
| 1 | Service gộp đọc và ghi: `capture/services/session.service.ts` có `createSession`, `completeSession` cạnh `listSessions`, `getSessionDetail`; `photo-review.service.ts` 1.917 dòng. `@nestjs/cqrs` không có trong `package.json` | §2.2 một use case một handler; §7 query handler không ghi; §16 điều cấm 10 | ⛔ |
| 2 | Không unit-of-work. `dataSource.transaction()` gọi ở 18 chỗ trong service (10 chỗ riêng trong `photo-review.service.ts`); 33 lần `.save()` trong đó nhiều lần commit độc lập ngoài transaction (`campaign.service.ts:241`, `device.service.ts:363`, `photo-review.service.ts:1261/1895/1901/1905`); `CommonService.saveWithTransaction(manager, …)` là kiểu "truyền manager tay" | §9.1 repository cấm tự commit; một use case một transaction; §16 điều cấm 6 | ⛔ |
| 3 | 17 entity TypeORM anemic: 0 method, 0 getter, field public; máy trạng thái session / variant nằm trong service. Không có domain event, không `AggregateRoot` | §2.3 aggregate giữ máy trạng thái, trả `Result`, phát sự kiện bên trong phương thức; §9.3 | ⛔ |
| 4 | Lỗi ràng buộc Postgres xử lý rải rác: ba bản `UNIQUE_VIOLATION = '23505'` (`campaign.service.ts:20`, `capture-angle-preset.service.ts:15`, `photo-kind.service.ts:13`); `error.constraint` được destructure ở `campaign.service.ts:146` nhưng không đọc; 23505 chưa map → `HttpExceptionFilter` trả **422 kèm message Postgres**; `TypeOrmExceptionFilter` trả 500 cho cùng loại lỗi → hai filter chồng nhau | §11.1 mỗi tầng dịch đúng một bậc; §11.2 tên ràng buộc là hợp đồng, dịch tập trung ở tầng bền vững; `ck_*` lộ ra là lỗi lập trình → 500 | ⛔ |
| 5 | `device-event.service.ts:69` commit transaction rồi gọi `PhotoReviewService.ensureSetForApprovedSession()` + `reprocess()` **ngoài** transaction (best-effort, có comment); `session.service.ts` cũng vậy | §6 side-effect của một lệnh ghi (outbox, stats) phải nằm **cùng** transaction, qua sự kiện miền dispatch trước commit | ⛔ |
| 6 | Ba bảng outbox (`upload_outbox`, `video_upload_outbox`, `variant_upload_outbox`) + ba worker gần giống nhau; `computeNextRetryAt` và hằng số backoff copy 2 lần có chủ ý; `pollScans()` và `retryPurgedUploads()` không khoá gì → nhân bản process là chạy trùng | §8.1 mọi worker cùng khung 5 bước; §8.3 bầu chủ trước khi nhân bản; nghiệp vụ đi qua bus như API | ⚠ |
| 7 | Một process, một `AppModule`, 4 `@Cron` là provider thường trong `CaptureModule`/`PhotoReviewModule`; không có `SERVICE_TYPE` | §2.1 ba host khác nhau về uptime, tần suất deploy, quyền ghi | ⚠ |
| 8 | Không có cổng lint/arch test: `eslint.config.mjs` chỉ có recommended + prettier; không `dependency-cruiser`, không root eslint | §13.2 sáu cổng tự động; cổng "không có `using` xuyên tầng" là quan trọng nhất | ⚠ |
| 9 | Ghép module chéo: `device-management/controllers/device-self.controller.ts` inject `PhotoService`, `SessionVideoService` của `capture`; `device-event.service.ts` gọi `CaptureReportService` + `PhotoReviewService`; `photo-review.service.ts` **raw SQL** vào `sessions`, `photos`, `upload_outbox` của module khác (dòng 225, 259, 268, 306, 868, 1865) | §2.2 handler không gọi handler khác; §3 một tầng chỉ nhìn kiểu của ranh giới nó đứng | ⚠ |
| 10 | `common/errors/code.constants.error.ts` gộp mã lỗi của mọi module (1xxx session … 8xxx attempt); `photo-review` tự tách bảng 9xxx riêng → quy ước đã vỡ. `common/guards/sso-auth.guard.ts` upsert `users`, bootstrap admin, cache profile | §2.6 `Common` không chứa quy tắc nghiệp vụ | ⚠ |
| 11 | Envelope không thống nhất: thành công `{statusCode, message, data}`, lỗi `{errorCode, message}`; không có correlation id trong log | §3 ranh giới 1 trả `BaseApiResponse`; §4 ① Logging ở ngoài cùng | ⚠ |
| 12 | Không validate env lúc boot (không Joi/zod); fail-fast rải ở `ApiKeyMiddleware` constructor và `FileStorageService.onModuleInit`; `PYTHON_AI_BASE_URL` đọc inline trong service | §2.1 host là nơi duy nhất đọc cấu hình môi trường | ⚠ |
| 13 | `CommonService.softDelete()` chết (không entity nào có cột xoá mềm); `common/dao/`, `modules/shared/` là module lai chứa primitives | Dọn khi gộp `shared/` | ⚠ |
| 14 | Không `Idempotency-Key` inbound; ghi đã idempotent bằng natural key + `ON CONFLICT` (`photos`, `upload_outbox`, `sessions`); `device_events` batch **không** dedup (ghi rõ trong `device-event.service.ts:40`) | §9.4 hợp đồng idempotency — xem §5, một phần bỏ qua có chủ ý | ⚠ |

---

## 3. Cấu trúc thư mục đích

```
apps/api/src/
├── main.ts                        # bootstrap; SERVICE_TYPE=command|query|worker|all → chọn root module
├── app.module.ts                  # all  — dev / máy đơn: import cả ba dưới
├── app-command.module.ts          # HTTP ghi (kiosk, CMS) — import <m>CommandModule của mọi module
├── app-query.module.ts            # HTTP đọc — import <m>QueryModule; KHÔNG ScheduleModule, KHÔNG UnitOfWork
├── app-worker.module.ts           # cron — import <m>WorkerModule + ScheduleModule.forRoot()
│
├── shared/                        # TẦNG XUYÊN SUỐT — không nghiệp vụ, không import modules/**
│   ├── config/                    # registerAs() (giữ từ src/config) + env.schema.ts (zod) validate lúc boot
│   ├── constants/
│   ├── domain/                    # aggregate-root.ts · domain-event.ts · value-object.ts · result.ts
│   ├── cqrs/                      # transactional-command.handler.ts (base) · domain-event.dispatcher.ts
│   │                              # · correlation.context.ts (AsyncLocalStorage)
│   ├── errors/                    # application.exception.ts (base) · business-rule.exception.ts
│   │                              # · conflict.exception.ts · not-found.exception.ts · validation.exception.ts
│   │                              # · error-code.registry.ts (mỗi module đăng ký dải mã riêng, không gộp)
│   ├── database/                  # typeorm-config.service.ts · db.migrate.config.ts · migrations/
│   │                              # · base.entity.ts · unit-of-work.ts · transaction-context.ts
│   │                              # · constraint-error.translator.ts · advisory-lock.service.ts
│   ├── integrations/              # TẦNG 4b — adapter cho port của application; không biết nghiệp vụ
│   │   ├── file-service/          # file-service.adapter.ts (bọc @face/fs-client) · integration-outcome.ts
│   │   ├── python-ai/             # photo-ai.adapter.ts (fetch sidecar) — chuyển từ photo-review/services
│   │   ├── sso/                   # sso-profile.adapter.ts (fetch /auth/profile) — tách khỏi guard
│   │   └── dainam-student/        # student-directory.adapter.ts — chuyển từ modules/shared/services
│   ├── auth/                      # sso-auth.guard.ts (chỉ xác thực + gọi identity command) · api-key.middleware.ts
│   │                              # · roles.guard.ts (gộp AdminRoleGuard + ReviewerRoleGuard)
│   ├── http/                      # response-envelope.interceptor.ts · logging.interceptor.ts
│   │                              # · all-exceptions.filter.ts (MỘT filter) · validation.pipe.ts
│   │                              # · api-response.decorator.ts · pagination.ts · swagger.ts · express.d.ts
│   ├── jobs/                      # background_jobs generic (Q18): background-job.entity.ts · job.repository.ts
│   │                              # · enqueue() gọi trong cùng transaction · job-drainer.ts (claim SKIP LOCKED
│   │                              #   → commandBus.execute theo kind) — cho AI 4x6, export zip, in thẻ, thông báo
│   └── workers/                   # leader-cron.worker.ts (base: scope riêng, advisory lock, không chết vòng lặp)
│                                  # · outbox-drainer.ts (generic: claim SKIP LOCKED → port → backoff)
│
└── modules/
    ├── identity/                  # MỚI — tách khỏi common/guards: users, upsert từ SSO, bootstrap admin
    ├── campaign/                  # tách từ device-management: campaigns, campaign_members,
    │                              #   capture_angle_presets, capture_configurations
    ├── device/                    # tách từ device-management: devices, device_events, secret rotation
    ├── capture/                   # sessions, photos, session_videos, upload_outbox, video_upload_outbox
    ├── photo-review/              # subject_photo_sets, photo_variants, photo_review_events, photo_kinds,
    │                              #   variant_upload_outbox
    ├── audit/                     # MỚI (Q20) — audit_logs; chỉ có event handlers + read; lắng nghe domain event
    │                              #   của mọi module, ghi trong cùng transaction; không ai xoá được
    ├── reporting/                 # MỚI (Q21) — chỉ queries + read repositories (SQL tổng hợp), đăng ký vào
    │                              #   AppQueryModule; không bảng dẫn xuất; thay phần thống kê của device-event.service
    │
    └── <module>/                  # KHUÔN BẮT BUỘC cho mọi module
        ├── <module>.module.ts                 # chỉ để dev/all; import ba sub-module dưới
        ├── <module>-command.module.ts         # controllers ghi + command handlers + event handlers + infrastructure
        ├── <module>-query.module.ts           # controllers đọc + query handlers + read repositories
        ├── <module>-worker.module.ts          # workers + command handlers nó cần (qua CommandBus)
        ├── <module>.error-codes.ts            # dải mã lỗi của module, đăng ký vào shared/errors registry
        │
        ├── presentation/                      # TẦNG 1 — dịch giao thức ↔ use case, không nghiệp vụ
        │   ├── kiosk/                         # client kiosk (Q15): device secret, prefix /kiosk, Swagger /docs/kiosk
        │   │   ├── <x>.command.controller.ts  # chỉ inject CommandBus
        │   │   └── <x>.query.controller.ts    # chỉ inject QueryBus
        │   ├── cms/                           # client CMS (Q15): SsoAuthGuard + roles, prefix /cms, Swagger /docs/cms
        │   │   ├── <x>.command.controller.ts
        │   │   └── <x>.query.controller.ts
        │   └── guards/                        # guard đặc thù module (vd campaign-member.guard.ts)
        │
        ├── application/                       # TẦNG 2 — dàn dựng use case
        │   ├── commands/
        │   │   ├── command/<verb>-<noun>.command.ts        # record thuần (readonly props)
        │   │   ├── handler/<verb>-<noun>.handler.ts        # extends TransactionalCommandHandler
        │   │   ├── transfer-model/<verb>-<noun>.dto.ts     # body từ API, class-validator
        │   │   ├── result/<verb>-<noun>.result.ts          # kiểu trả về (id, bool, DTO) — KHÔNG entity
        │   │   └── mapper/                                 # dto → tham số aggregate; aggregate → result
        │   ├── queries/
        │   │   ├── query/get-<noun>.query.ts
        │   │   ├── handler/get-<noun>.handler.ts           # KHÔNG UnitOfWork, KHÔNG ghi
        │   │   ├── read-model/<noun>.read-model.ts         # DTO trả ra (thay dao/ hiện tại)
        │   │   └── filter-model/<noun>.filter.ts           # tham số lọc + phân trang
        │   ├── events/<noun>-<past>.event-handler.ts       # handler sự kiện miền: ghi outbox, stats — CÙNG transaction
        │   └── ports/<name>.port.ts                        # interface ra ngoài mà module cần (FileServicePort…)
        │
        ├── domain/                            # TẦNG 3 — không import typeorm/@nestjs/shared-database/integrations
        │   ├── aggregate/<noun>.aggregate.ts              # extends AggregateRoot; phương thức đổi trạng thái trả Result
        │   ├── value-object/
        │   ├── event/<noun>-<past>.event.ts               # extends DomainEvent
        │   └── enum/
        │
        └── infrastructure/                    # TẦNG 4a — dịch aggregate ↔ bảng
            ├── persistence/<noun>.entity.ts               # TypeORM, một tệp một bảng
            ├── persistence/<noun>.mapper.ts               # entity ↔ aggregate
            ├── repositories/<noun>.repository.interface.ts  # + Symbol token
            ├── repositories/<noun>.repository.ts            # impl; lấy EntityManager từ TransactionContext
            ├── read/<noun>.read-repository.ts             # QueryBuilder / raw SQL → read-model; chỉ query dùng
            └── workers/<job>.worker.ts                    # extends LeaderCronWorker; thân là commandBus.execute()
```

**Năm điểm cần nói rõ về cây này**

1. **Tách `device-management` thành `campaign` + `device`, thêm `identity`.**
   `device-management` hiện gánh 6 bảng, 8 service, 8 controller và là nơi
   ghép chéo nhiều nhất (§2 dòng 9). Tách theo bảng: `campaign` (campaigns,
   campaign_members, capture_angle_presets, capture_configurations) và
   `device` (devices, device_events, secret rotation). `identity` nhận
   `users` và toàn bộ logic upsert/bootstrap admin đang nằm trong
   `SsoAuthGuard`. **Đã chốt 2026-09-11** (Q10, Q11 ở §7).
2. **`file-storage` không còn là module nghiệp vụ.** Nó là adapter ở
   `shared/integrations/file-service`. Module nào cần thì khai báo
   `FileServicePort` trong `application/ports/` và root module bind port →
   adapter. `photo.controller.ts` / `video.controller.ts` hiện import kiểu
   `PhotoViewLink` thẳng từ `file-storage` → chuyển kiểu ấy về
   `application/ports`.
3. **Glob entity không đổi.** `TypeOrmConfigService` đang glob
   `dist/modules/**/*.entity.js` → đường dẫn mới
   `modules/<m>/infrastructure/persistence/*.entity.ts` vẫn khớp, không cần
   sửa cấu hình DB khi di chuyển file.
4. **Hợp đồng API là một package ở cấp monorepo (Q14).**
   `packages/api-contract/` gồm `generated/` (kiểu sinh bằng
   `openapi-typescript` từ Swagger JSON của `apps/api`, script
   `pnpm contract:generate`) và `src/error-codes.ts` + hằng số viết tay.
   `apps/cms`, `apps/desktop`, `apps/web` import từ đây thay cho kiểu tự gõ
   trong `apps/cms/src/api.ts` (44 KB — nguồn của lỗi `{items, meta}` ngày
   08/09). CI fail nếu sinh lại mà có diff (§9).
5. **Bố cục test (Q16).** Spec đặt cạnh file. Ba jest project trong
   `apps/api/package.json`: `unit` (`*.spec.ts` trong `domain/` và
   `application/`, fake repository, không DB, < 5 s), `integration`
   (`*.int-spec.ts` trong `infrastructure/`, Postgres thật, mỗi test bọc
   trong transaction rollback qua `TransactionContext` — dùng lại chính UoW
   đang dựng), `e2e` (`test/*.e2e-spec.ts`, supertest qua HTTP). 14 spec hiện
   có đổi tên theo loại, không đổi nội dung. **Đặt tên (Q17):** camelCase
   trong TS cho aggregate / DTO / read-model; snake_case chỉ ở DB qua
   `SnakeNamingStrategy` — giữ như Looka hiện tại, không theo snake_case
   trong TS của `dynaform-service`.

---

## 4. Quy ước từng tầng — bản Looka

Đọc theo khuôn của spec §2: nhiệm vụ · nơi ở · nhận gì trả gì · được làm ·
cấm làm · kiểm bằng gì.

### 4.1. Host — `main.ts`, ba root module, `presentation/`

| | |
|---|---|
| Nhiệm vụ | Dịch HTTP / tín hiệu hẹn giờ thành command hoặc query, dịch kết quả thành envelope |
| Nhận | body + header + `x-api-key` / bearer / device secret |
| Trả | `{ statusCode, message, data, errorCode?, correlationId }` |
| Gọi xuống bằng | `commandBus.execute()` / `queryBus.execute()` — duy nhất |

**Ba host khác nhau ở điều gì (bản Looka)**

| | `command` | `query` | `worker` |
|---|---|---|---|
| Vào bằng | HTTP ghi từ kiosk (`/device-self/*`, `/sessions`, `/photos`), CMS ghi (campaign, duyệt ảnh) | HTTP đọc CMS + kiosk (danh sách campaign, gallery, thống kê) | `@Cron` |
| Uptime cần | cao nhất — kiosk đang chụp mà mất ghi là mất ảnh | trung bình | thấp — dừng 30 giây outbox chỉ chậm |
| Ghi DB | có | **không** (không import `UnitOfWork`) | có (qua CommandBus) |
| Nhân bản | tự do | tự do | drainers đã an toàn nhờ `SKIP LOCKED`; `pollScans` / `retryPurgedUploads` / job theo ngày phải có advisory lock |

**Cách `main.ts` chọn root module** (như `dynaform-service/src/main.ts`):

```ts
const serviceType = process.env.SERVICE_TYPE ?? 'all';
const RootModule = {
  command: AppCommandModule, query: AppQueryModule,
  worker: AppWorkerModule, all: AppModule,
}[serviceType];
```

Mỗi module nghiệp vụ export ba sub-module (`CaptureCommandModule`,
`CaptureQueryModule`, `CaptureWorkerModule`) — root module import đúng phần.
Chọn cách này thay vì "mỗi module tự lọc theo env" của dynaform vì tường
minh hơn và lint kiểm được (`app-query.module.ts` không được import
`*CommandModule`).

**Tách theo client bên trong presentation (Q15).** Hai client của Looka
khác nhau về tin cậy, xác thực và uptime: kiosk (device secret, ghi ảnh,
không được chết) và CMS (SSO bearer + role, quản trị). Mỗi module đặt
controller vào `presentation/kiosk/` (prefix `/kiosk`, guard device) hoặc
`presentation/cms/` (prefix `/cms`, `SsoAuthGuard` + `RolesGuard`); hai tài
liệu Swagger `/docs/kiosk` và `/docs/cms`. Đường dẫn cũ (`/v1/device-self/*`,
`/v1/campaigns/*`…) giữ alias trong giai đoạn chuyển đổi và xoá ở giai đoạn 5.
Cách này làm việc tách host thứ tư `SERVICE_TYPE=kiosk` sau này chỉ còn là
thêm một root module import các `*KioskCommandModule` — không phải làm ngay.

**✅ Được làm:** bind + validate hình thức (`ValidationPipe`, có sẵn); đọc
header, user, device từ guard rồi truyền xuống command dưới dạng tham số;
route, version, Swagger; đăng ký DI — **nơi duy nhất** bind port → adapter
(`{ provide: FILE_SERVICE_PORT, useClass: FileServiceAdapter }`).

**⛔ Cấm:** inject `Repository`, `DataSource`, `EntityManager` (trừ
`/health`); `try/catch` dựng response lỗi; bất kỳ `if` nào về nghiệp vụ
(quota, trạng thái campaign, quyền duyệt); gọi `fetch`; import
`shared/integrations/*` (host chỉ biết token của port, không biết adapter).

> **Quy thuộc lấy từ credential, không lấy từ body** (spec §2.1). Device
> secret → `deviceId` → `campaignId`; bearer → `userId`. Nếu body kiosk gửi
> `campaignId` khác thì **bỏ qua**. Hiện `AddDevicePhotoDto` nhận từ body —
> kiểm lại khi chuyển `device-self.controller.ts`.

### 4.2. Điều phối — `application/`

| | |
|---|---|
| Nhận | `XCommand` / `XQuery` — class readonly props, không method |
| Trả | id · bool · result DTO · read-model — ⛔ không bao giờ trả entity TypeORM hoặc aggregate |

**Command handler — khuôn bắt buộc**

```ts
@CommandHandler(CompleteSessionCommand)
export class CompleteSessionHandler
  extends TransactionalCommandHandler<CompleteSessionCommand, CompleteSessionResult> {
  constructor(uow: UnitOfWork,
              @Inject(SESSION_REPOSITORY) private readonly sessions: ISessionRepository) { super(uow); }

  protected async handle(cmd: CompleteSessionCommand): Promise<CompleteSessionResult> {
    const session = await this.sessions.findByIdForUpdate(cmd.sessionId);   // 🔒 FOR NO KEY UPDATE
    if (!session) throw new NotFoundException(CAPTURE_ERROR.SESSION_NOT_FOUND);

    const r = session.complete(cmd.completedAt, cmd.actorUserId);           // aggregate quyết
    if (r.isAlreadyDone) return { sessionId: session.id, alreadyCompleted: true }; // rowcount=0 không phải lỗi
    if (!r.isSuccess) throw new BusinessRuleException(CAPTURE_ERROR.SESSION_NOT_COMPLETABLE, r.error);

    await this.sessions.save(session);   // không commit; UoW commit sau khi dispatch SessionCompletedEvent
    return { sessionId: session.id, alreadyCompleted: false };
  }
}
```

`TransactionalCommandHandler.execute()` = `uow.run(() => this.handle(cmd))`.
`UnitOfWork.run()`: mở `QueryRunner`, `startTransaction`, đặt `EntityManager`
vào `TransactionContext` (AsyncLocalStorage), chạy `fn`, **dispatch mọi
domain event của aggregate đã `save()`** (đồng bộ, await) rồi `commit`; lỗi
→ `rollback` + `translateConstraintError(err)` rồi ném lại. Đây là bốn thứ
của spec §9 gộp vào một chỗ.

**✅ Được làm:** đọc cấu hình và quyền (campaign mở? user là member đã
duyệt?); gọi phương thức aggregate và **xử lý `Result`**; gọi port
(`FileServicePort`, `PhotoAiPort`) — nhưng **sau commit** hoặc từ worker,
không trong `handle()` đang giữ transaction; ghi outbox / stats / audit trong
**cùng** transaction qua event handler; dịch `Result` thất bại và
`IntegrationOutcome` thành exception nghiệp vụ.

**⛔ Cấm:** gán trạng thái trực tiếp (`session.status = COMPLETED`); import
`shared/integrations/*` hoặc `typeorm`; `dataSource.transaction()` /
`manager.save()` trong handler; query handler ghi bất kỳ gì; command handler
gọi query handler hoặc handler module khác (dùng bus hoặc port); `fetch`.

> **Handler hay aggregate?** Cùng câu hỏi của spec: nếu luật chỉ cần dữ liệu
> **bên trong** một aggregate thì đặt ở aggregate. "Session đã hoàn tất thì
> không nhận thêm ảnh" → `Session`. "Campaign đã hết hạn và user chưa được
> duyệt thì không được chụp" cần `campaigns` + `campaign_members` + giờ server
> → handler.

### 4.3. Miền — `domain/`

| | |
|---|---|
| Nơi ở | `modules/<m>/domain/`; primitives ở `shared/domain/` |
| Nhận | kiểu nguyên thuỷ, value object, `now: Date` từ ngoài |
| Trả | `Result<T>` — ⛔ không ném exception cho lỗi nghiệp vụ dự đoán được |
| Import | chỉ `shared/domain` và chính nó |

**Các aggregate và bất biến từng cái (đề xuất, chốt khi đến từng giai đoạn)**

| Aggregate | Bất biến nó giữ | Module |
|---|---|---|
| `Campaign` | trạng thái suy ra từ ngày + `manualStatus`; góc chụp là tập con của catalog; quota là cảnh báo không phải chặn (Q21 đã chốt) | campaign |
| `CampaignMembership` | một user một dòng cho mỗi campaign; chuyển `PENDING → APPROVED/REJECTED` một chiều | campaign |
| `Device` | secret cũ chỉ sống trong cửa sổ overlap; thu hồi là một chiều | device |
| `Session` | `IN_PROGRESS → COMPLETED` một chiều, `complete()` idempotent; không nhận ảnh sau khi hoàn tất | capture |
| `Photo` / `SessionVideo` | `(sessionId, stepId, attempt)` duy nhất; attempt bị thay thế không quay lại | capture |
| `SubjectPhotoSet` + `PhotoVariant` | một set cho mỗi session được duyệt; variant `DRAFT → APPROVED / DISCARDED`; chỉ một variant `APPROVED` cho mỗi `photo_kind` | photo-review |

**Bất biến KHÔNG đặt ở tầng này** (spec §2.3 — CSDL giữ bất biến giữa các
process): `(session_id, step_id, attempt)` duy nhất, `campaigns.code` duy
nhất, `upload_outbox.idem_key` duy nhất, `capture_angle_presets.code` duy
nhất. Chúng đã là unique index; **không** viết lại bằng `SELECT` rồi
`INSERT`. Tên constraint của chúng là hợp đồng với §4.4.

**⛔ Cấm:** import `typeorm`, `@nestjs/*`, `shared/database`,
`shared/integrations`; `new Date()` bên trong phương thức nghiệp vụ (nhận
`now`); setter public trên cột trạng thái; biết `tenant` để làm gì ngoài lưu.

### 4.4. Cổng bền vững — `infrastructure/` + `shared/database/`

**✅ Được làm:** mapper entity ↔ aggregate (`*.mapper.ts`); repository lấy
`EntityManager` từ `TransactionContext.current() ?? dataSource.manager`
(thay cho `saveWithTransaction(manager, …)`); `findByIdForUpdate()` bằng
`setLock('pessimistic_write')` hoặc `FOR NO KEY UPDATE`; read repository trả
read-model qua QueryBuilder / raw SQL (raw SQL **chỉ** được ở đây); **dịch
tên constraint** thành exception có kiểu.

**Bảng dịch ràng buộc → hành vi API (bản Looka, khởi điểm)**

| Constraint / SQLSTATE | Nghĩa | API trả |
|---|---|---|
| `uq_campaigns_code` (23505) | trùng mã campaign | 409 `CAMPAIGN_CODE_TAKEN` |
| `uq_capture_angle_presets_code` (23505) | trùng mã góc | 409 `CAPTURE_ANGLE_PRESET_CODE_TAKEN` |
| `uq_photo_kinds_code` (23505) | trùng mã loại ảnh | 409 `PHOTO_KIND_CODE_TAKEN` |
| `uq_photos_session_step_attempt` (23505) | ảnh đã có | 200 — trả ảnh cũ (idempotent), không tạo thứ hai |
| `uq_upload_outbox_idem_key` (23505) | outbox đã có | nuốt — `ON CONFLICT DO NOTHING` như hiện tại |
| `uq_campaign_members` (23505) | đã join | 200 — trả dòng cũ |
| 23503 (FK) | tham chiếu không tồn tại | 404 hoặc 409 theo module khai báo |
| 23502 / 23514 (`ck_*`) | dữ liệu sai hình thức | **500** — đáng lẽ validator đã chặn; cảnh báo riêng |
| 23505 chưa khai báo | — | 409 chung, **không** lộ message Postgres |

Mỗi module khai báo phần của mình trong `<module>.error-codes.ts`;
`constraint-error.translator.ts` chỉ gộp bảng. Tên constraint hiện tại trong
27 migration phần lớn do TypeORM tự sinh (`UQ_…` hash) — giai đoạn 0 cần một
migration **đổi tên** về dạng đọc được (`uq_<table>_<cols>`) để bảng trên
dùng được. Đây là việc nhỏ nhưng phải làm sớm.

**⛔ Cấm:** nghiệp vụ trong repository; `dataSource.transaction()` /
`commit` trong repository; trả `SelectQueryBuilder` ra khỏi
`infrastructure/`; module này raw SQL vào bảng module khác (§2 dòng 9 —
`photo-review` đọc `sessions`/`photos` → qua `QueryBus` của `capture` —
**đã chốt Q9**, không thêm read port).

### 4.5. Cổng đối tác — `application/ports/` + `shared/integrations/`

| Port (interface, ở module cần) | Adapter (ở `shared/integrations/`) | Thay cho |
|---|---|---|
| `FileServicePort` — `upload(bytes, path, idemKey)`, `issueViewLink`, `cancelUpload`, `scanStatus` | `file-service.adapter.ts` bọc `FsClient` | `modules/file-storage/services/file-storage.service.ts` + hai chỗ `fetch(link.url)` trần trong `photo-review.service.ts:326, 1796` |
| `PhotoAiPort` — `makeCardPhoto`, `edit`, `identitySimilarity` | `python-ai/photo-ai.adapter.ts` | `photo-review-sidecar.service.ts` |
| `SsoProfilePort` — `profile(bearer)` | `sso/sso-profile.adapter.ts` | `fetch` trong `sso-auth.guard.ts:193` |
| `StudentDirectoryPort` | `dainam-student/student-directory.adapter.ts` | `modules/shared/services/dainam-student-info.client.ts` |

Adapter trả `IntegrationOutcome` (`Success<T> · Retryable · Terminal ·
Timeout · Unavailable`), **không** ném exception cho lỗi dự đoán được,
**không** biết HTTP status của API Looka. Bẫy của spec §11.1 áp dụng nguyên
văn: "fs-core từ chối vì key sai" (Terminal, lỗi cấu hình của ta) và "fs-core
timeout" (Retryable, lỗi mạng) là **hai sự cố khác nhau** — không gộp thành
một `FAILED`.

**⛔ Cấm trong `shared/integrations/`:** import `modules/**`; nhận tham số
`campaignId` / `sessionId` / `tenant` để *quyết định* gì (chỉ được dùng để
ghép đường dẫn khi handler đã tính sẵn); quyết trạng thái của bất kỳ bản ghi
nào.

### 4.6. Worker — `infrastructure/workers/` + `shared/workers/`

Khung 5 bước của spec §8.1, bản NestJS:

```ts
export abstract class LeaderCronWorker {
  constructor(protected readonly lock: AdvisoryLockService,
              protected readonly bus: CommandBus, private readonly name: string) {}
  protected async tick(): Promise<void> {
    if (this.running) return;                                       // re-entrancy như hiện tại
    this.running = true;
    try {
      await this.lock.withXactLock(this.name, async () => {         // ② bầu chủ — pg_try_advisory_xact_lock
        await this.bus.execute(this.command());                     // ③ nghiệp vụ đi qua bus
      });
    } catch (e) { this.logger.error(e); }                           // ⑤ lỗi không giết vòng lặp
    finally { this.running = false; }
  }
  protected abstract command(): ICommand;
}
```

`@Cron` nằm ở lớp con (`UploadOutboxDrainWorker extends LeaderCronWorker`).
Ba drainer hiện tại gộp thành **một** `OutboxDrainer<TRow>` generic ở
`shared/workers/outbox-drainer.ts` nhận: entity outbox, hàm `send(row,
port)`, hằng backoff. Claim vẫn `FOR UPDATE SKIP LOCKED` (đúng, giữ nguyên);
advisory lock chỉ bắt buộc cho `pollScans`, `retryPurgedUploads` và mọi job
theo ngày.

**Sáu công việc nền hiện có → khung mới**

| Job hiện tại | Nhịp | Thành |
|---|---|---|
| `UploadWorkerService.drain()` | 3 s | `OutboxDrainer<UploadOutboxEntry>` |
| `UploadWorkerService.drainPurgeRecovery()` | 30 s | `RetryPurgedUploadsCommand` + advisory lock |
| `pollScans()` (gọi trong `drain`) | 3 s | `PollScanStatusCommand` + advisory lock |
| `VideoUploadWorkerService.drain()` | 3 s | `OutboxDrainer<VideoUploadOutboxEntry>` |
| `VariantUploadWorkerService.drain()` | 3 s | `OutboxDrainer<VariantUploadOutboxEntry>` |
| `OnModuleInit` reset `SENDING → PENDING` ×3 | boot | một `RecoverStuckOutboxCommand` cho cả ba bảng |

Gộp ba bảng outbox thành một: **đã chốt không gộp (Q12)** — giữ ba bảng,
chỉ gộp worker; tránh migration dữ liệu `bytea` khi chưa cần.

**Việc nền không phải upload — `background_jobs` (Q18).** Gọi sidecar AI
làm ảnh 4x6 sau khi duyệt session, export zip, sau này in thẻ / thông báo:
hiện `reprocess()` được gọi best-effort ngay sau commit, không hàng đợi,
không retry. Thay bằng **một** bảng `background_jobs` (`kind`, `payload
jsonb`, `status`, `attempts`, `next_run_at`, `idem_key` unique,
`correlation_id`) ở `shared/jobs/`. Event handler gọi `jobs.enqueue()`
**trong cùng transaction** với nghiệp vụ (outbox pattern), `JobDrainer`
claim bằng `SKIP LOCKED` rồi `commandBus.execute()` theo `kind`; backoff
dùng chung `computeNextRetryAt`. Không BullMQ, không Redis (§5). Upload
vẫn đi ba bảng outbox riêng vì payload là `bytea` lớn.

### 4.7. Tầng xuyên suốt — `shared/`

Gộp `src/common/` + `src/modules/shared/common/` + `src/config/` +
`src/database/`. Ba thứ hiện ở đây **phải đi ra**: bảng mã lỗi của mọi
module (`code.constants.error.ts` → mỗi module một `*.error-codes.ts`, đăng
ký vào registry); logic upsert `users` + bootstrap admin trong
`SsoAuthGuard` (→ `modules/identity`, guard chỉ gọi
`commandBus.execute(new UpsertUserFromSsoCommand(profile))`);
`api-key-or-sso.guard.ts` mang quyết định riêng cho hai route của
`StudentController` (→ `capture/presentation/guards`).

Thứ **không** được vào `shared/`: bất kỳ quy tắc nghiệp vụ nào; bất kỳ
import nào từ `modules/**` (lint chặn).

### 4.8. Mô hình lỗi — bốn bậc dịch

```
Adapter            IntegrationOutcome  (Success · Retryable · Terminal · Timeout · Unavailable)
Aggregate          Result<T>           (isSuccess · error code · isAlreadyDone)
Handler            ApplicationException: ValidationException · BusinessRuleException · ConflictException · NotFoundException
UnitOfWork         QueryFailedError → ConflictException / NotFoundException / 500 theo bảng §4.4
Global filter      { statusCode, errorCode, message (tiếng Việt), correlationId }
```

Mỗi tầng dịch **đúng một bậc**. Một `AllExceptionsFilter` duy nhất thay hai
filter hiện tại; `CustomException` hiện có giữ làm lớp tương thích trong
giai đoạn chuyển đổi rồi xoá.

### 4.9. Đường đi của một lệnh ghi — kiosk gửi ảnh (bản Looka của spec §5)

```
kiosk ──POST /device-self/photos (device secret)──► DeviceSelfPhotoCommandController
  └─► commandBus.execute(AddDevicePhotoCommand{deviceId, sessionId, stepId, attempt, bytes…})
        └─► ① LoggingInterceptor gắn correlationId  ② ValidationPipe đã chạy ở controller
        └─► AddDevicePhotoHandler.execute → uow.run (BEGIN 🔒)
              ├─ 🔍 sessions.findByIdForUpdate  (hoặc tạo — ON CONFLICT (id) DO NOTHING như hiện tại)
              ├─ session.addPhoto(stepId, attempt, meta, now) → Result + PhotoAddedEvent
              ├─ ✍ photos (mapper → entity; unique (session_id, step_id, attempt) → 200 trả ảnh cũ)
              ├─ dispatch PhotoAddedEvent → PhotoAddedEventHandler ✍ upload_outbox (cùng 🔒)
              └─ COMMIT
        └─► trả { photoId, outboxQueued } → envelope
worker ──3 s──► OutboxDrainer claim (SKIP LOCKED) → FileServicePort.upload(idemKey) → PENDING/FAILED/DONE
```

Ba luật của spec §5 giữ nguyên: **ghi DB trước khi gọi fs-core** (đã đúng
nhờ outbox), **transaction đóng trước khi gọi ra ngoài** (drainer gọi ngoài
transaction), side-effect nằm **cùng** transaction với ảnh (hiện đúng trong
`photo.service.ts:144`, nhưng `device-event.service.ts` thì chưa — §2 dòng 5).

---

## 5. Phần của spec bỏ qua hoặc giảm nhẹ

| Mục spec | Quyết định cho Looka | Lý do |
|---|---|---|
| §2.4 Redis / `IRedisHandling` | **Bỏ.** Không thêm Redis. Cache profile SSO 60 s giữ `Map` process-local, ghi rõ là mất được | Looka không có Redis; 0,x request/giây; thêm hạ tầng là thêm nguồn sự thật thứ hai |
| §2.5 `ThirdServices.<Bank>` + engine ánh xạ trường bằng dữ liệu (`pm_partner_mappings`) | **Giảm nhẹ** thành port + adapter. Không có engine ánh xạ cấu hình | Looka có 4 đối tác cố định, mỗi đối tác một hợp đồng riêng; không có "N ngân hàng cùng một giao thức" |
| §9.4 `pay_idempotency_keys` + `IdempotencyBehavior` (bảng khoá theo `Idempotency-Key` header) | **Không dựng bảng khoá chung.** Giữ idempotency bằng natural key + `ON CONFLICT` (đã đúng cho photos / outbox / sessions). Chỉ thêm dedup cho batch `device_events` (**Q6**) | Client của Looka là kiosk của ta, không phải bên thứ ba cần hợp đồng công khai; natural key đã bao phủ mọi lệnh ghi có tiền lệ lặp |
| §2.4 `pay_inbound_messages` ghi bằng DbContext riêng, commit độc lập trước khi xử lý | **Áp dụng có điều kiện** cho `device_events` — bản tin vào duy nhất của Looka (**Q5**) | Cùng lý do spec: xử lý hỏng không được mất bằng chứng kiosk đã gửi gì |
| §8.2 đối soát, sổ cái, trần chi theo ngày, `fn_business_date` | **Không có tương đương.** Bỏ | Không có đường tiền |
| §12 vai DB không sở hữu bảng | **Làm sau** (giai đoạn 5). Không thuộc cấu trúc thư mục | Cần phối hợp vận hành; không chặn việc phân tầng |
| §1.2 `GrpcProtos` | Bỏ | Looka không có gRPC |
| Multi-tenant (`tenant_code` trên mọi bảng, `UserContext` theo tenant) | **Bỏ — đơn tenant (Q19).** `tenant` chỉ là tên namespace trên fs-core, đặt trong config; không thêm cột `tenant_id`, không `TenantContext`. Đơn vị con (khoa, CTSV) là role, không phải tenant | Một deployment phục vụ một trường; cần thêm trường thì deploy thêm instance |
| §2.3 "`AsNoTracking` cho mọi truy vấn đọc" | Không có khái niệm tracking trong TypeORM. Tương đương: query handler không được gọi `save()` — ép bằng việc `*QueryModule` không import `UnitOfWork` | — |
| §2.4 "lọc `is_deleted` trong mọi truy vấn" | Không áp dụng — Looka không dùng xoá mềm (0 entity có cột). Xoá `CommonService.softDelete()` chết | `PhotoVariantStatus.DISCARDED` là trạng thái nghiệp vụ, không phải xoá mềm |
| §4 pipeline 5 behavior như một chuỗi | NestJS không có pipeline cho bus → ① ② ở host (interceptor/pipe), ④ ⑤ trong `UnitOfWork`, ③ bỏ (dòng trên) | Thứ tự vẫn đúng: log ngoài cùng, validate trước transaction, transaction ôm đúng handler, dispatch trước commit |

---

## 6. Lộ trình tăng dần

Mỗi giai đoạn có **điều kiện nghiệm thu** riêng. Không giai đoạn nào được
bắt đầu khi giai đoạn trước chưa xanh. Toàn bộ 158 file đang chưa commit
(theo `docs/ROADMAP.md`) phải được kiểm thử end-to-end và commit **trước**
giai đoạn 0 — không trộn hai đợt thay đổi lớn vào một working tree.

> **Liên hệ với `cms-8-screens-api-plan.md` (cùng ngày 11/09/2026).** Kế
> hoạch đó thêm **16 bảng mới** (workflows, workflow_versions,
> ai_pipeline_steps, campaign_subjects, campaign_kiosk_assignments,
> print_batches, print_items, card_templates, printers, roles, permissions…)
> tức là ít nhất 4–5 module backend mới (`workflow`, `print`,
> `card-template`, `printer`, `rbac`). Theo Q4 ("module mới viết theo cấu
> trúc mới ngay"), **giai đoạn 0 của tài liệu này phải xong trước khi P1 của
> kế hoạch kia bắt đầu** — nếu không, 16 bảng mới sẽ được viết theo kiểu
> controller → service → raw SQL và trở thành khoản nợ lớn nhất phải chuyển
> đổi. Ngược lại, các module mới ấy là nơi tốt nhất để chứng minh khuôn §3
> mà không phải di chuyển code cũ. Thứ tự đề xuất: commit 158 file → giai
> đoạn 0 → module mới của CMS 8 màn (theo khuôn mới) song song với giai
> đoạn 1 (campaign). **Thứ tự này chưa chốt** — người dùng chốt ngày
> 11/09/2026 rằng hiện tại chỉ lên plan, chưa code; quyết khi bắt đầu.

### Giai đoạn 0 — Nền dùng chung, không đổi hành vi

> **Trạng thái 2026-09-11: đã triển khai phần lớn, chưa commit.** Người
> dùng đổi sang Sonnet 5 và nói "đọc docs để tái cấu trúc backend đi" —
> theo CLAUDE.md quy tắc 4, Sonnet được code trực tiếp, không cần agent
> phụ. Việc bắt đầu vì working tree lúc đó sạch (158 file của
> [[campaign-sso-pivot-2026-09-08]] đã được commit từ trước, không còn
> trộn lẫn). Chi tiết xác minh ở cuối bảng.

| Việc | Chi tiết | Trạng thái |
|---|---|---|
| Cài `@nestjs/cqrs`; tạo `app-command/query/worker.module.ts`; `main.ts` đọc `SERVICE_TYPE` (mặc định `all`) | Ba root module ban đầu import y hệt `AppModule` — chỉ để có chỗ đứng | ✅ Xong. `@nestjs/cqrs@11.0.3` (ghim đúng theo Nest 11, không dùng bản 12 mới nhất — lệch peer dep). Bốn `SERVICE_TYPE` đã boot-test thật với DB dev thật (không phải mock) |
| Gộp `common/` + `modules/shared/common/` + `config/` + `database/` → `shared/` theo cây §3; đổi alias `@app/common` → `@app/shared` | Move thuần, không đổi logic; xoá `CommonService.softDelete`, `common/dao/` | ✅ Xong bằng `git mv` (giữ lịch sử). `CommonService`/`common/dao/` **chưa xoá** — để nguyên, không phải phạm vi bắt buộc của việc gộp thư mục |
| `shared/domain`: `AggregateRoot`, `DomainEvent`, `ValueObject`, `Result` | Copy từ `dynaform-service/src/shared/domain` + thêm `result.ts` | ✅ Xong. Đặt tên camelCase theo Q17 (không snake_case như dynaform); `Result` có thêm trạng thái `noop` phân biệt "đã làm rồi" khỏi "thất bại" (spec §16 điều cấm 9) |
| `shared/database`: `UnitOfWork`, `TransactionContext` (AsyncLocalStorage), `AdvisoryLockService`, `constraint-error.translator.ts` | Chưa ai gọi, nhưng có test đơn vị với Postgres thật (như các persistence spec hiện có) | ⚠ Code xong, **build + boot-test xanh, nhưng CHƯA có unit test riêng** (đúng như dự kiến — chưa module nào gọi để test tích hợp được). `DomainEventDispatcher` dùng `DiscoveryService` + `@OnDomainEvent(eventName: string)` — key theo string, không theo class, vì `ICommandHandler` là conditional type không dùng được ở constraint mở |
| Migration **đổi tên constraint** về dạng `uq_<table>_<cols>` / `fk_…` / `ck_…` | Dùng `ALTER INDEX … RENAME` / `ALTER TABLE … RENAME CONSTRAINT`; không đổi dữ liệu | ⏸ **Cố ý chưa làm.** Đổi tên constraint là thay đổi trạng thái DB thật (dù an toàn/đảo ngược được) — không tự chạy migration lên DB dev thật của người dùng khi chưa được xác nhận. Để Giai đoạn 1, khi `campaign` module thật sự cần bảng dịch constraint |
| `shared/errors`: bốn exception có kiểu + registry mã lỗi; **một** `AllExceptionsFilter`; envelope thống nhất; `LoggingInterceptor` + correlation id | `CustomException` giữ lại, map sang lớp mới; hai filter cũ xoá | ✅ Xong và **đã wire vào `main.ts`** thay hai filter cũ. Giữ đúng hành vi cũ cho lỗi TypeORM chưa đăng ký (422, như trước) — chỉ sửa đúng phần đã xác nhận là bug (hai filter chồng nhau) |
| `shared/config/env.schema.ts` (zod) validate lúc boot | Gom `PYTHON_AI_BASE_URL`, `TEST_DATABASE_URL` vào `.env.example` | ✅ Xong, wire vào `main.ts`. **`.env.example` chưa cập nhật** — bỏ sót, nên làm trước khi merge |
| `shared/integrations`: chuyển `FileStorageService`, sidecar client, Dainam client, `fetch` SSO thành adapter + `IntegrationOutcome`; port interface đặt tạm ở `shared/integrations/ports` cho tới khi module chủ ra đời | Service cũ giữ tên cũ làm facade mỏng gọi adapter — caller chưa phải đổi | ⚠ **Một phần.** `IntegrationOutcome` + SSO adapter (`fetchSsoProfile`, hàm thuần — không phải class, để không phá `sso-auth.guard.spec.ts` vốn `new SsoAuthGuard(...)` tay và mock `global.fetch`) + Dainam adapter (đổi hẳn, 0 caller nên an toàn) đã xong, đã xác minh 15/15 test SSO xanh. **`FileServicePort`/`PhotoAiPort` và việc chuyển `FileStorageService`/`photo-review-sidecar.service.ts` CHƯA làm** — hoãn sang Giai đoạn 2/4 vì rủi ro cao hơn giá trị ngay lúc này (8+ điểm gọi, không muốn vội trong một phiên đã rất dài) |
| `packages/api-contract` (Q14): script `contract:generate` bằng `openapi-typescript` từ Swagger JSON + `error-codes.ts` tay; CI check không có diff | Chưa client nào import — chỉ dựng khung và cổng CI | ⏸ **Chưa làm** — hoãn cùng lý do effort/rủi ro |
| Ba jest project `unit` / `integration` / `e2e` (Q16); helper `withRollback()` bọc mỗi integration test trong transaction qua `TransactionContext`; đổi tên 14 spec hiện có theo loại | Nội dung test không đổi | ⏸ **Chưa làm** — 14 spec giữ nguyên vị trí/tên, `jest` config chưa tách project |
| `shared/jobs` (Q18): bảng `background_jobs` + `JobDrainer` + `enqueue()`; `shared/workers`: `LeaderCronWorker`, `OutboxDrainer` | Chưa ai enqueue; drainer chạy rỗng | ⚠ **Một phần, có chủ ý thu hẹp.** `LeaderCronWorker` xong đầy đủ. `background_jobs`: **cố ý CHƯA tạo entity/migration** — một bảng không ai ghi là schema chết chưa kiểm chứng; chỉ viết `IBackgroundJobRepository`/`IBackgroundJobHandler` (interface), entity+migration để Giai đoạn 4 khi `photo-review` thật sự cần. `OutboxDrainer` generic **chưa viết** — chỉ có `backoff.util.ts` dùng chung; gộp 3 worker hiện tại là việc của Giai đoạn 2 |
| Cổng lint (§9) ở mức **warn** | Để thấy toàn bộ vi phạm hiện có mà chưa chặn build | ✅ Xong — `dependency-cruiser`, script `lint:arch`, 4 rule ở mức warn. Chạy thật: phát hiện đúng 15 vi phạm cross-module đã biết (khớp audit ban đầu) + 1 vi phạm `shared→modules` đã biết (SsoAuthGuard→User) |

**Đã xác minh thật (không phải suy đoán), 2026-09-11:**
- `pnpm --filter @face/api build` xanh sau mỗi bước.
- `pnpm test`: 61/61 test không cần DB xanh — **giống hệt baseline trước khi
  sửa** (7 suite cần `TEST_DATABASE_URL` tự skip, đúng như trước).
- `sso-auth.guard.spec.ts` riêng: 15/15 xanh — xác nhận việc tách SSO fetch
  ra adapter không đổi hành vi.
- **Boot thật cả bốn `SERVICE_TYPE`** (`all`/`command`/`query`/`worker`)
  bằng `node dist/main.js` với `.env` dev thật — DB dev **thật sự kết nối
  được** từ sandbox này (khác giả định trước đó trong
  [[campaign-sso-pivot-2026-09-08]]). `all` đạt "Application is running";
  `command`/`query`/`worker` đều init DI sạch, 0 lỗi. `query` xác nhận
  **không** có dòng `ScheduleModule` trong log (không đăng ký cron, đúng
  tiêu chí nghiệm thu); `command` cũng không có (thiết kế: chỉ `worker`
  chạy cron); `worker` có.
- `pnpm exec eslint` trên toàn bộ file mới/sửa đáng kể: **0 lỗi, 0
  warning** sau khi sửa tay 5 vấn đề thật (không phải chỉ `--fix`) — bao
  gồm một cặp rule ESLint mâu thuẫn nhau (`no-unsafe-enum-comparison` vs
  `no-unnecessary-type-assertion`) giải quyết bằng cách bỏ hẳn so sánh
  enum. 678 lỗi lint tổng trên toàn `src/` là **nợ có từ trước**, xác minh
  bằng `git diff` rỗng trên các file lỗi nhiều nhất — không phải do phiên
  này gây ra, không sửa (ngoài phạm vi Giai đoạn 0).
- **Chưa chạy được:** test tích hợp cần `TEST_DATABASE_URL` (biến này
  không có trong `.env`, không tự đặt để tránh chạm nhầm DB thật); test
  end-to-end qua kiosk/CMS thật.
- **Chưa commit** — theo [[commit-only-after-full-test]], chờ người dùng
  xác nhận đã kiểm thử xong.

**Việc còn thiếu để đóng Giai đoạn 0 hoàn toàn** (không chặn Giai đoạn 1,
nhưng nên làm trước khi coi Giai đoạn 0 là "xong"): migration đổi tên
constraint; `FileServicePort`/`PhotoAiPort` + chuyển hẳn hai service lớn;
`packages/api-contract`; ba jest project; `OutboxDrainer` generic +
`background_jobs` entity/migration; cập nhật `.env.example`.

### Giai đoạn 1 — Module thí điểm: `campaign` (tách từ `device-management`)

Chọn vì: bảng nhỏ, ít raw SQL, đã có unique constraint có ý nghĩa
(`campaigns.code`, `capture_angle_presets.code`), có máy trạng thái suy ra
(status theo ngày), và là nơi lỗi 23505 đang xử lý tay.

| Việc | Chi tiết |
|---|---|
| `Campaign`, `CampaignMembership`, `CaptureAnglePreset`, `CaptureConfiguration` aggregate + mapper + repository interface | Chuyển `campaign-status.util.ts` (đã có spec) vào aggregate |
| Commands: create / update / set-manual-status / hide campaign; upsert angle preset; join campaign; decide membership | Handler kế thừa `TransactionalCommandHandler` |
| Queries: list campaigns (gated theo `serverTime` + membership), detail, members pending, angle catalog, stats | Read repository trả read-model; `dao/` cũ đổi tên |
| Controllers tách `*.command.controller.ts` / `*.query.controller.ts`; `CampaignMemberGuard` sang `presentation/guards` | Đường dẫn HTTP **không đổi** — CMS và kiosk không cần sửa |
| Bảng dịch constraint của module (409 `CAMPAIGN_CODE_TAKEN` …) khai báo trong `campaign.error-codes.ts` | Xoá ba bản `'23505'` |
| `campaign.service.ts` xoá; `SessionService.countByCampaign` mà nó gọi → `CountSessionsByCampaignQuery` qua `QueryBus` | Cắt cạnh chéo đầu tiên |
| Controller đặt theo client (Q15): CMS CRUD vào `presentation/cms/`, kiosk chỉ có `presentation/kiosk/campaign.query.controller.ts` (danh sách campaign được phép chụp) | Alias đường dẫn cũ giữ tới giai đoạn 5 |
| `apps/cms` chuyển phần campaign trong `api.ts` sang import `packages/api-contract` (Q14) | Client đầu tiên dùng contract; xoá kiểu tự gõ tương ứng |
| `modules/reporting` khởi tạo (Q21) với thống kê campaign / auto-manual hiện tính trong `device-event.service.ts` → read repository trong `reporting` | `reporting` chỉ đăng ký vào `AppQueryModule` |

**Nghiệm thu:** `campaign-config-sso.spec.ts` và `device-management-
persistence.spec.ts` phần campaign xanh sau khi trỏ sang bus; test thuần cho
aggregate (không DB) chạy < 1 s; lint cổng "presentation không import
infrastructure" **error** cho `modules/campaign/**`.

### Giai đoạn 2 — `capture` (rủi ro cao nhất về dữ liệu: đường ảnh)

| Việc | Chi tiết |
|---|---|
| `Session` aggregate với `complete()` idempotent, `addPhoto()`, `addVideo()`; `Photo`, `SessionVideo` | Máy trạng thái ra khỏi `session.service.ts` / `photo.service.ts` |
| `PhotoAddedEvent` / `VideoAddedEvent` → event handler ghi outbox **cùng** transaction | Thay raw `INSERT … ON CONFLICT` trong `photo.service.ts:144, 267` |
| `OutboxDrainer` generic + `LeaderCronWorker`; ba worker cũ thành cấu hình | `computeNextRetryAt` một bản; `pollScans` / `retryPurgedUploads` thành command + advisory lock |
| `device-self.controller.ts` (ảnh/video) chuyển **về `capture/presentation`**; command mang `deviceId` từ guard, không từ body | Cắt cạnh `device-management → capture` |
| `CaptureReportService` (ghi từ batch device_events) thành các command của `capture` mà `device` gọi qua bus | Chuẩn bị cho giai đoạn 3 |

**Nghiệm thu:** 4 persistence spec của capture + `upload-worker.service.
spec.ts` xanh; kiểm thử thủ công một phiên chụp thật kiosk → fs-core; đối
chiếu số dòng `upload_outbox` trước/sau bằng nhau cho cùng kịch bản.

### Giai đoạn 3 — `device` + `identity`

| Việc | Chi tiết |
|---|---|
| `Device` aggregate (self-enroll, rotate secret với overlap, revoke) | Từ `device.service.ts` |
| `device_events`: ghi audit row **⚡ commit riêng trước**, rồi xử lý side-effect trong transaction nghiệp vụ (**Q5 đã chốt**); dedup theo `batchId` do kiosk sinh — cột mới + unique index + `ON CONFLICT DO NOTHING`, kèm thay đổi nhỏ ở `packages/core` và `apps/desktop` để sinh `batchId` mỗi batch (**Q6 đã chốt**) | Bỏ hẳn kiểu "commit rồi gọi photo-review best-effort" → `SessionApprovedEvent` do `capture` phát, `photo-review` lắng nghe qua bus |
| `identity`: `User` aggregate, `UpsertUserFromSsoCommand`, bootstrap admin; `SsoAuthGuard` chỉ xác thực + gọi command | Xoá logic ghi DB khỏi `shared/auth` |
| `modules/audit` (Q20): bảng `audit_logs` (actor, action, aggregate type/id, before/after jsonb, correlationId, occurredAt); event handler lắng nghe domain event của `campaign` / `device` / `identity` (và `capture`, `photo-review` khi tới lượt) ghi trong cùng transaction; migration `fn_audit_no_delete` trigger chặn `DELETE`/`TRUNCATE` như spec | `photo_review_events` hiện có giữ nguyên, trở thành một nguồn của audit ở giai đoạn 4 |

### Giai đoạn 4 — `photo-review` (file lớn nhất, 1.917 dòng)

| Việc | Chi tiết |
|---|---|
| `SubjectPhotoSet` + `PhotoVariant` aggregate với máy trạng thái variant | 10 lần `dataSource.transaction()` trong một service → mỗi use case một handler |
| `PhotoAiPort` thay sidecar service; hai `fetch(link.url)` trần → `FileServicePort.download` | — |
| `reprocess()` best-effort sau commit → job `PHOTO_REVIEW_PROCESS` trong `background_jobs` (Q18), enqueue từ handler của `SessionApprovedEvent` trong cùng transaction; `JobDrainer` gọi `ProcessSubjectPhotoSetCommand` → `PhotoAiPort` | Retry/backoff có sẵn; sidecar chết không mất việc |
| Raw SQL vào `sessions` / `photos` / `upload_outbox` → `QueryBus` của `capture` (**Q9 đã chốt**) | Cắt cạnh chéo cuối cùng |
| `variant_upload_outbox` → `OutboxDrainer` | Giữ bảng riêng (**Q12 đã chốt**), chỉ đổi worker; không migration dữ liệu |

### Giai đoạn 5 — Siết và tách deploy

- Cổng lint và arch test chuyển **warn → error** toàn `apps/api`.
- Xoá `CommonService`, `CustomException`, facade tạm của giai đoạn 0.
- Chạy prod thật ba process (`command` / `query` / `worker`) — cần
  `pnpm --filter @face/api start:prod` nhận `SERVICE_TYPE`, cập nhật script
  triển khai.
- Vai DB `looka_app` không sở hữu bảng (§1 dòng cuối).
- Xoá §2 của tài liệu này khi khoảng cách đóng lại (như spec §14 tự nói).

---

## 7. Câu hỏi đã chốt và còn mở

Chốt qua trao đổi ngày 11/09/2026 (hai vòng hỏi). Cột "Ảnh hưởng" cho biết
giai đoạn nào ở §6 dùng câu trả lời.

| # | Câu hỏi | Ảnh hưởng | Kết luận |
|---|---|---|---|
| Q5 | `device_events` ghi audit row **commit riêng trước** khi xử lý (spec §6 / `pay_inbound_messages`), hay giữ cùng transaction như hiện tại? | Giai đoạn 3 | **ĐÃ CHỐT: ghi riêng trước, xử lý sau.** Hai transaction: ⚡ audit row, rồi 🔒 side-effect. Xử lý hỏng vẫn còn bằng chứng và retry được từ audit row |
| Q6 | Dedup batch `device_events` theo `batchId` do kiosk sinh (unique index, `ON CONFLICT DO NOTHING`)? | Giai đoạn 3; kiosk phải gửi `batchId` | **ĐÃ CHỐT: có.** Kèm thay đổi nhỏ ở `packages/core` + `apps/desktop` để sinh `batchId` mỗi batch |
| Q7 | Query handler được raw SQL trực tiếp, hay bắt buộc qua `infrastructure/read/*.read-repository.ts`? | Mọi giai đoạn | **ĐÃ CHỐT: bắt buộc qua read repository.** `application/` không import `typeorm`; cổng lint §9 giữ nguyên mức chặt |
| Q8 | Tên thư mục xuyên suốt: đổi `common/` → `shared/` (như dynaform) hay giữ `common/`? | Giai đoạn 0 | **Mặc định `shared/`** — chưa hỏi riêng vì rủi ro thấp; đồng bộ với `dynaform-service`, và `modules/shared` hiện tại gây nhầm. Phản đối thì đổi lại trước giai đoạn 0 |
| Q9 | `photo-review` đọc `sessions` / `photos`: qua `QueryBus` của `capture` (in-process) hay một read port `CaptureReadPort` do `capture` implement? | Giai đoạn 4 | **ĐÃ CHỐT: `QueryBus`.** Không thêm interface; lint chỉ cấm import `modules/capture/infrastructure/**` và `*.service.ts` |
| Q10 | Tách `device-management` thành `campaign` + `device`? | Giai đoạn 1, 3 | **ĐÃ CHỐT: tách.** Giai đoạn 1 chỉ chuyển `campaign` |
| Q11 | Tách `identity` (users, upsert SSO, bootstrap admin) thành module riêng? | Giai đoạn 3 | **ĐÃ CHỐT: tách thành `modules/identity`.** Guard chỉ xác thực và gọi `UpsertUserFromSsoCommand`; rbac của CMS 8 màn (nếu làm) đặt ở đây |
| Q12 | Gộp ba bảng outbox thành một `upload_outbox` có cột `kind`, hay giữ ba bảng + một worker generic? | Giai đoạn 2, 4 | **ĐÃ CHỐT: giữ ba bảng, gộp worker.** Không migration dữ liệu `bytea` |
| Q13 | Thứ tự giữa: commit 158 file đang dở → giai đoạn 0 → P1 của `cms-8-screens-api-plan.md`? | Trước khi bắt đầu bất kỳ giai đoạn nào | **CHƯA CHỐT.** Người dùng: *hiện tại chỉ cần lên plan, chưa code.* Đề xuất giữ nguyên ở §6 (nền trước, module mới theo khuôn mới); quyết khi có lệnh bắt đầu |

**Vòng 3 — cải thiện cấu trúc** (người dùng hỏi "còn câu hỏi nào để cải
thiện structure không?", cùng ngày; tất cả chọn theo đề xuất)

| # | Câu hỏi | Ảnh hưởng | Kết luận |
|---|---|---|---|
| Q14 | Hợp đồng API giữa `apps/api` và cms / desktop / web — hiện `apps/cms/src/api.ts` tự gõ 44 KB kiểu, đã gây lỗi lệch `{items, meta}` | Giai đoạn 0 (khung), 1+ (từng client) | **ĐÃ CHỐT: `packages/api-contract` sinh từ Swagger bằng `openapi-typescript` + mã lỗi viết tay; CI fail nếu sinh lại có diff** |
| Q15 | Tách presentation theo client (kiosk vs CMS) ngoài tách command/query? | Giai đoạn 1+ | **ĐÃ CHỐT: `presentation/kiosk/` và `presentation/cms/`, prefix `/kiosk` `/cms`, Swagger riêng.** Host thứ tư `SERVICE_TYPE=kiosk` để ngỏ, không làm ngay |
| Q16 | Bố cục test: 14 spec integration trên DB chung không rollback, vị trí không thống nhất | Giai đoạn 0 | **ĐÃ CHỐT: ba jest project unit / integration / e2e, spec cạnh file, integration bọc rollback qua `TransactionContext`** |
| Q17 | camelCase trong TS (Looka) hay snake_case trong TS (dynaform)? | Mọi giai đoạn | **ĐÃ CHỐT: camelCase trong TS, snake_case chỉ ở DB** |
| Q18 | Việc nền không phải upload (AI 4x6, export, in thẻ) chạy qua gì? | Giai đoạn 0 (khung), 4 (AI) | **ĐÃ CHỐT: một bảng `background_jobs` generic + `JobDrainer`, enqueue cùng transaction.** Không BullMQ/Redis |
| Q19 | Looka có cần multi-tenant thật không? | Giai đoạn 0 | **ĐÃ CHỐT: đơn tenant.** `tenant` chỉ là config fs-core; không cột `tenant_id` |
| Q20 | Nhật ký kiểm toán: đưa vào cấu trúc ngay? | Giai đoạn 3 | **ĐÃ CHỐT: `modules/audit`, ghi `audit_logs` từ domain event trong cùng transaction, trigger chặn xoá** |
| Q21 | Thống kê / dashboard: tính lúc đọc, materialize, hay materialized view? | Giai đoạn 1 | **ĐÃ CHỐT: `modules/reporting` chỉ đọc, tính lúc đọc qua read repository; không bảng dẫn xuất** |

**Mặc định không hỏi (đổi nếu phản đối):** migration giữ **một** thư mục
trung tâm `shared/database/migrations/` với lịch sử tuyến tính (không tách
theo module); URI versioning `/v1` giữ nguyên.

---

## 8. Mười điều cấm — bản Looka, đọc trước mỗi pull request

| # | ⛔ |
|---|---|
| 1 | Controller inject `Repository` / `DataSource` / `EntityManager`, hoặc gọi service thay vì bus |
| 2 | Handler gán trạng thái (`session.status = …`) thay vì gọi phương thức aggregate |
| 3 | `domain/` import `typeorm`, `@nestjs/*`, `shared/database`, `shared/integrations` |
| 4 | `application/` hoặc `presentation/` import `shared/integrations/**` (chỉ được biết port) |
| 5 | `if (adapterName === …)` hoặc `switch` theo tên đối tác ở tầng điều phối |
| 6 | Repository gọi `dataSource.transaction()`, `commit`, hoặc `manager.save()` ngoài `TransactionContext` |
| 7 | Gọi port (fs-core, sidecar, SSO) **bên trong** `handle()` đang giữ transaction |
| 8 | Gọi đối tác trước khi ghi DB trên đường ảnh (ảnh phải vào `photos` + outbox trước) |
| 9 | `UPDATE` trạng thái không mang điều kiện trạng thái cũ, hoặc coi `rowcount = 0` là lỗi |
| 10 | Query handler ghi dữ liệu — kể cả "chỉ cập nhật `last_seen_at`" |

---

## 9. Cổng tự động — bản Looka

| Cổng | Khẳng định | Công cụ | Từ giai đoạn |
|---|---|---|---|
| Tham chiếu | `modules/*/domain/**` không import gì ngoài `shared/domain` và chính module | `eslint-plugin-boundaries` (element types: `domain`, `application`, `infrastructure`, `presentation`, `shared-*`) | 0 (warn) → 5 (error) |
| Tham chiếu | `application/**` và `presentation/**` không import `infrastructure/**` của bất kỳ module nào, không import `shared/integrations/**`, không import `typeorm` | ⟪ | ⟪ |
| Tham chiếu | `shared/**` không import `modules/**` | ⟪ | 0 (error ngay — hiện chưa vi phạm trừ `sso-auth.guard` inject `User`) |
| Tham chiếu | `modules/<a>/**` không import `modules/<b>/infrastructure/**` hoặc `modules/<b>/**/*.service.ts`; chỉ được import `command/`, `query/`, `read-model/`, `event/` của module khác | ⟪ | 1 |
| Tham chiếu | `app-query.module.ts` không import `*CommandModule`, `*WorkerModule`, `UnitOfWork`, `ScheduleModule` | jest arch test đọc import graph bằng `dependency-cruiser` | 0 |
| Quét mã | `grep` trả rỗng cho: `dataSource.transaction(` ngoài `shared/database`; `.save(` ngoài `infrastructure/repositories`; `fetch(` ngoài `shared/integrations`; `'23505'` ngoài `constraint-error.translator` | script CI đơn giản | 1 |
| Kiểm thử độc lập | Test của `domain/**` chạy không cần `TEST_DATABASE_URL`, toàn bộ < 5 s | jest project riêng `domain` | 1 |
| Hồi quy hành vi | Swagger JSON không đổi giữa các giai đoạn (trừ khi có quyết định đổi API) | snapshot test | 0 |
| Hợp đồng | `pnpm contract:generate` chạy lại trên `packages/api-contract` không tạo diff; không app nào còn import kiểu API tự gõ | CI: generate rồi `git diff --exit-code`; lint `no-restricted-imports` ở cms/desktop/web | 0 (generate), 5 (cấm tự gõ) |
| Host theo client | `presentation/kiosk/**` không dùng `SsoAuthGuard`; `presentation/cms/**` không dùng guard device secret | jest arch test | 1 |
| Việc nền | Không còn `.then(` / `void` gọi service khác sau commit trong handler; mọi side-effect ngoài transaction đi qua `background_jobs` hoặc outbox | grep + review | 2 |

> Cổng thứ tư (module không import service module khác) là cổng quan trọng
> nhất với Looka — chính là cách `device-self.controller.ts` đã inject
> `PhotoService` của `capture` "chỉ chỗ này thôi".

---

## 10. Tự kiểm — bảy câu cho một pull request chạm đường ảnh

1. Đoạn mã mới nằm ở tầng nào, và tầng đó có được biết thứ nó đang import không?
2. Luật này Postgres đã ép bằng unique / FK / check chưa? Nếu rồi, vì sao viết lại bằng `SELECT` rồi `INSERT`?
3. Có `.save()` hoặc `dataSource.transaction()` nào nằm ngoài `UnitOfWork` không?
4. Có lượt gọi fs-core / sidecar / SSO nào nằm trong transaction không?
5. `UPDATE` trạng thái có điều kiện trạng thái cũ và có xử lý `rowcount = 0` như "đã làm rồi" không?
6. Lỗi mới được dịch đúng **một** bậc, hay nhảy từ `FsError` thẳng ra HTTP?
7. Kiosk gửi lại request này lần thứ hai thì có tạo hai lần side-effect không?

---

## 11. Đọc tiếp

| Cần gì | Đọc |
|---|---|
| Spec gốc, đầy đủ 17 mục | "Đặc tả phân tầng ứng dụng" (bản chia sẻ 11/09/2026); bản trích markdown đã lưu tạm trong phiên làm việc, nên copy vào `docs/reference/` nếu muốn giữ |
| Mẫu house style NestJS đang chạy thật | `D:\Work\dynaform-service\src\{main.ts, app-command.module.ts, shared/domain, modules/form-instance}` |
| Hiện trạng và các quyết định nghiệp vụ đã chốt | `docs/ROADMAP.md`, `docs/plans/campaign-config-sso-card-photo-discussion.md` §7 |
| Scope backend mới sắp tới (16 bảng, 8 màn CMS) — nơi áp dụng khuôn §3 đầu tiên | `docs/plans/cms-8-screens-api-plan.md` §4, §5 |
| Luồng ảnh → fs-core hiện tại | `docs/photo-upload-storage-flow.md` |

---

> **6 tầng · 6 ranh giới · 19 quyết định đã chốt (Q1–Q21; Q8 mặc định) · 1 việc chưa chốt (Q13 thứ tự thực hiện) · 11/09/2026 · chưa code**
>
> Tài liệu này mô tả **đích**. §2 là khoảng cách giữa đích và hiện trạng;
> khi khoảng cách đóng lại, xoá §2 chứ đừng sửa phần còn lại.
