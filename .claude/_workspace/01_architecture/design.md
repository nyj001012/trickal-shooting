# 트릭컬 슈팅게임 — 시스템 아키텍처 설계서 (Greyboxing Phase)

- **문서 버전:** 3.8 (스킬탄 타깃 락온 + 근접 회전 부스트로 공전 방지)
- **작성:** system-architect (Phase 1)
- **상태:** `[APPROVED]` — 기술 스택 / 표준 명령어 / 소유권 경로 모두 확정됨
- **저장소:** `D:\dev\trickal-shooting` (신규, `README.md`만 존재)
- **단계 목표:** 에셋 없이 도형만으로 **게임플레이 루프의 골격을 검증**한다. 이 단계의 최우선 품질 목표는 **"게임 로직의 단위 테스트 가능성"** 이다.

> **하위 에이전트 필독 규칙**
> 이 문서의 「2. 기술 스택」·「3. 디렉터리 구조 및 소유권」·「4. 표준 명령어」·「5. 계약 산출 형식」·「6. 아키텍처 규약」은 **전 팀의 SSOT(Single Source of Truth)** 이며, **각 에이전트 정의 파일의 일반 규정보다 우선한다.**
> 여기에 없는 라이브러리·도구·경로·명령을 임의로 도입하지 않는다. 모순이나 누락을 발견하면 작업을 멈추고 오케스트레이터에게 질의한다.
> **언어는 TypeScript로 확정되었다. `.js` / `.jsx` 소스 파일을 새로 만들지 않는다.** 설정 파일도 `*.config.ts`를 사용한다.

---

## 1. 범위 및 제약 (Scope & Constraints)

### 1.1 이번 단계에 포함되는 것
| 항목 | 내용 |
| --- | --- |
| 실행 형태 | **클라이언트 단독 웹 애플리케이션** (브라우저 1개 탭에서 완결) |
| 렌더링 | HTML5 Canvas 2D, **논리 해상도 800 x 600 고정** |
| 화면 레이아웃 | 뷰포트 전체를 사용하는 반응형 셸. 게임 보드는 4:3 비율을 유지하면서 뷰포트 안의 최대 크기로 중앙 정렬 |
| HUD | HP / MANA / SCORE / LEVEL 4개 항목 (뼈대 코드의 표기 유지) |
| 게임 요소 | 플레이어(에르핀), 적(슬라임), 일반탄·유도 스킬탄, MANA 스킬 상태, 스폰 웨이브, 충돌 판정, 점수/레벨 |
| 시각 표현 | **그레이박스**: 사각형/원 + 색상 팔레트만. 이미지·스프라이트·사운드 에셋 **일절 사용 금지** |

### 1.2 이번 단계 **범위 밖** (설계하지 않음)
- 백엔드 서버, REST/GraphQL API, 데이터베이스, 인증/인가
- 네트워크 통신, 멀티플레이, 랭킹 서버, 영속 저장(localStorage 포함 — 필요해지면 별도 승인)
- **배포 인프라 전체**: CI/CD 파이프라인, 컨테이너화, 클라우드 리소스, 모니터링/APM
  → `devops-engineer` 및 `04_infrastructure` 산출물은 **이번 파이프라인에서 생성하지 않는다.**
- 사운드, 이펙트, 애니메이션 스프라이트, **모바일 터치 입력**, i18n
- 모바일 가로모드는 **표시 레이아웃만 지원**한다. 키보드 입력 계약은 유지하며 터치 조작 UI는 별도 요구사항으로 다룬다.

### 1.3 데이터 제약
- **영속 데이터 없음.** 모든 게임 데이터는 **인메모리 게임 상태 객체** 하나로 표현되며 새로고침 시 초기화된다.
- 서버 상태 관리 라이브러리(React Query / SWR 등)는 **불필요하므로 도입 금지**.

---

## 2. 기술 스택 (확정)

> 실행 환경 실측: **Node v24.16.0 / npm 11.13.0** (Windows 11, PowerShell). 아래 스택은 이 환경에서 검증 가능한 조합이다.

| 계층 | 확정 기술 | 버전 범위 | 선정 근거 | 탈락 대안 |
| --- | --- | --- | --- | --- |
| **언어** | **TypeScript (strict) + TSX** | `typescript@^5.7`, target ES2022 | 이 프로젝트에 특히 유효한 3가지 이득: ① **엔티티 판별 유니온** — `kind` 판별자로 플레이어/적/투사체를 모델링하면 `switch` 누락을 `never` 검사로 컴파일 타임에 잡아, 엔티티 종류가 늘어날 때 렌더·충돌·전투 시스템의 갱신 누락이 원천 차단된다. ② **계약의 컴파일러 강제** — `tech-leader`가 정의한 인터페이스를 `frontend-developer`가 이탈하면 문서 리뷰가 아니라 **빌드 실패**로 즉시 드러난다(§5). ③ **리팩터링 안전성** — 그레이박싱은 정의상 구조를 계속 뒤엎는 단계이며, 엔티티 필드·시스템 시그니처 변경 시 영향 범위가 타입으로 전수 추적된다. 추가로 좌표(px)/속도(px·s⁻¹)/시간(초) 혼동을 타입과 JSDoc 단위 주석으로 봉쇄한다. | 순수 JavaScript(계약 강제 불가, 판별 유니온 부재), JSDoc + `checkJs`(표현력·IDE 지원·리팩터링 도구 열세) |
| **빌드/개발 서버** | **Vite** | `vite@^7` | ESM 네이티브 dev 서버로 HMR이 즉각적이라 게임 튜닝 반복에 최적. TS는 esbuild로 **타입 검사 없이 트랜스파일**되므로 빌드가 빠르고, 타입 검사는 `tsc --noEmit`으로 분리된다(§4). Node 20.19+ 요구 — 현 환경(24.16) 충족. | CRA(지원 종료), Webpack+ts-loader(빌드 지연), Parcel(생태계 통합 약함) |
| **UI 프레임워크** | **React** | `react@^19`, `react-dom@^19` | 뼈대 코드가 React 기반. HUD 동기화에 필요한 `useSyncExternalStore`가 표준 제공되어 "게임 루프 ↔ React" 경계를 관용적으로 구현 가능. | Preact(React 19 타입/API 호환 리스크), 순수 DOM(HUD 상태 관리 수작업) |
| **React 타입** | `@types/react`, `@types/react-dom` | `^19` | React 19 타입 정의. `ReactNode`/`RefObject` 시그니처가 18과 다르므로 **버전을 react와 메이저 일치**시킨다. | — |
| **React 플러그인** | `@vitejs/plugin-react` | `^4` | Vite 공식 플러그인, Fast Refresh 제공. | SWC 플러그인(이 규모에서 이득 없음) |
| **전역 상태** | **없음 (자체 경량 스토어)** | — | 게임 상태는 ref/모듈에 두고 HUD만 `useSyncExternalStore`로 구독한다(§6.1). 외부 라이브러리는 프레임 루프와 충돌하고 오버킬. | Redux / Zustand / Jotai (매 프레임 dispatch 시 성능 붕괴) |
| **단위/컴포넌트 테스트** | **Vitest** | `vitest@^3` | Vite의 TS 해석을 그대로 재사용해 별도 트랜스폼 설정이 불필요(ts-jest 대비 결정적 이점). **환경을 파일별로 전환**할 수 있어 순수 로직은 `node`, 컴포넌트는 `jsdom`으로 분리 실행 가능(이번 설계의 핵심 요구). | Jest + ts-jest(ESM/TS 설정 비용 및 속도 열세) |
| **커버리지** | `@vitest/coverage-v8` | `^3` | Vitest 공식 프로바이더, 별도 계측 설정 불필요. | istanbul(속도 열세) |
| **컴포넌트 테스트 유틸** | **@testing-library/react** + **user-event** + **jest-dom** | `^16` / `^14` / `^6` | 내부 state가 아닌 **렌더 결과(텍스트·role)** 기준 검증을 강제 → `frontend-qa` 원칙과 일치. 타입 정의 내장. | Enzyme(React 19 미지원) |
| **DOM 환경** | **jsdom** | `jsdom@^25` | 컴포넌트 테스트용. Canvas 2D 컨텍스트 미구현이므로 `vitest.setup.ts`에서 `getContext` 스텁 주입(§6.8). | happy-dom(canvas 스텁 호환성 검증 비용) |
| **E2E** | **Playwright** | `@playwright/test@^1.49` | TS 스펙을 네이티브 실행하며 tsconfig `paths`를 인식한다. 캔버스 게임 검증에 필요한 trace·스크린샷·비디오 증거 수집이 기본 제공. | Cypress(캔버스/타이머 제어 및 trace 열세) |
| **린터** | **ESLint 9 flat config + typescript-eslint** | `eslint@^9`, `@eslint/js@^9`, `typescript-eslint@^8`, `eslint-plugin-react-hooks@^5`, `eslint-plugin-react-refresh@^0.4`, `globals@^15` | 훅 규칙 위반(게임 루프에서 흔한 stale closure)과 **`any` 유입·불필요한 단언**을 정적으로 차단. typescript-eslint의 **타입 인지(type-aware) 규칙**을 켜서 `no-unsafe-*` 계열을 활성화한다. | Biome(타입 인지 규칙 부재), eslint 8 legacy config(EOL) |
| **포매터** | **Prettier** | `prettier@^3` + `eslint-config-prettier@^9` | 포맷 논쟁 제거, ESLint와 역할 분리. | ESLint stylistic(유지 비용) |
| **패키지 매니저** | **npm** | `npm@11.13.0` (실측) | 추가 설치 없이 현 환경에서 즉시 사용. `package-lock.json` **커밋 필수**. | pnpm/yarn(설치 단계 및 환경 편차 리스크) |

### 2.1 의존성 확정 목록 (scaffolding 시 이 목록만 설치)
- **dependencies:** `react`, `react-dom`
- **devDependencies:**
  `typescript`, `@types/react`, `@types/react-dom`, `@types/node`,
  `vite`, `@vitejs/plugin-react`,
  `vitest`, `@vitest/coverage-v8`, `jsdom`,
  `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`,
  `@playwright/test`,
  `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`,
  `prettier`, `eslint-config-prettier`

> 이 목록에 없는 패키지 추가는 **오케스트레이터 승인** 필요. 특히 게임 엔진(Phaser, PixiJS, Excalibur), 상태 관리, 애니메이션 라이브러리는 **도입 금지**다. 사유: 그레이박싱의 목적은 *자체 게임 루프의 구조적 타당성 검증*이며, 엔진을 도입하면 검증 대상이 사라진다.

---

## 2.2 TypeScript 컴파일러 규약 (tsconfig 정책) — 신설

### 2.2.1 tsconfig 파일 구성 (단일 vs 분리 — **분리 확정, 단 project references는 사용하지 않는다**)

| 파일 | 소유 | 대상(include) | 환경 | 용도 |
| --- | --- | --- | --- | --- |
| `tsconfig.json` | FE-DEV | `src`, `tests`, `e2e` | 브라우저 (`lib: ES2022, DOM, DOM.Iterable`) | **앱·계약·테스트·E2E 전부**. 에디터와 `tsc --noEmit`의 기본 프로젝트. |
| `tsconfig.node.json` | FE-DEV | `*.config.ts` (`vite.config.ts`, `playwright.config.ts`, `eslint.config.ts`) | Node (`types: ["node"]`) | 빌드/도구 설정 파일 전용. DOM 타입을 앱과 섞지 않기 위해 분리. |

**판단 근거**
- `tsconfig.app.json` / project references(`tsc -b`) 구조는 **채택하지 않는다.** `tsc --build`는 `--noEmit`과 함께 쓸 수 없어 `tsBuildInfo` 관리와 스크립트가 복잡해지는데, 이 프로젝트는 단일 번들·단일 타깃이라 참조 그래프의 이득이 없다.
- 대신 **2개 프로젝트를 순차 검사**한다: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`.
- `tests`와 `e2e`를 앱과 **같은 프로젝트**에 넣는 이유: QA/E2E가 작성한 코드도 동일 strict 규칙으로 검사되어야 하며, 별도 프로젝트로 쪼개면 계약 타입 참조가 끊긴다.

**각 도구가 참조하는 tsconfig (확정)**

| 도구 | 참조 | 비고 |
| --- | --- | --- |
| Vite (dev/build) | `tsconfig.json` (esbuild가 `target`·`jsx`·`useDefineForClassFields`만 사용) | **타입 검사를 하지 않는다.** 그래서 `build` 스크립트가 `tsc --noEmit`을 선행한다. |
| Vitest | Vite와 동일(`vite.config.ts` 경유) | 테스트 실행 시 타입 검사 없음. 타입 검증은 `npm run typecheck`가 담당. |
| Playwright | `tsconfig.json` (`e2e/` 포함되어 `@/*` alias 인식) | `playwright.config.ts` 자체는 `tsconfig.node.json` 대상. |
| ESLint (type-aware) | `projectService: true` (typescript-eslint 8) | 두 tsconfig를 자동 탐색. 수동 `project` 배열 열거 금지. |
| 에디터(IDE) | `tsconfig.json` | — |

### 2.2.2 컴파일러 옵션 확정

| 옵션 | 값 | 판단 근거 (게임 루프 코드 영향 포함) |
| --- | --- | --- |
| `strict` | **`true`** | 전 항목 필수. 완화 금지. `strictNullChecks`가 `canvasRef.current` / `getContext('2d')` 널 미처리(원본 뼈대의 실제 버그 소지)를 잡는다. |
| `noUncheckedIndexedAccess` | **`false`** | **의도적으로 끈다.** 이 게임은 매 틱 `enemies[i]` / `regularProjectiles[i]` / `skillProjectiles[i]`를 순회하는 핫 루프가 코드의 중심인데, 이 옵션은 모든 인덱스 접근 결과를 `T \| undefined`로 만들어 **틱마다 의미 없는 널 가드 또는 `!` 단언을 강요**한다. `!` 남발은 오히려 타입 안전성을 떨어뜨린다. **대체 방어책(강제):** ① 배열 순회는 `for...of` / `.forEach` / `.filter` / `.map`을 기본으로 하고 인덱스 루프는 길이 보장이 자명한 경우로 한정, ② `.find()` 등 **명시적으로 `undefined`를 반환하는 API의 결과는 반드시 널 검사**(이 옵션과 무관하게 strict가 잡음), ③ 이 규칙 위반은 리뷰 반려 사유(§6.4). |
| `noUnusedLocals` / `noUnusedParameters` | **`true`** | 죽은 코드·오타 조기 발견. 그레이박싱에서 실험하다 남은 잔재를 자동 제거하게 만든다. 의도적 미사용 인자는 `_` 접두사로 표기(`argsIgnorePattern: "^_"`). |
| `verbatimModuleSyntax` | **`true`** | 타입 전용 import를 `import type`으로 **강제**한다. esbuild는 파일 단위 트랜스파일이라 타입/값 구분을 못해 런타임 import 잔존이나 순환 참조 사고가 생기는데, 이 옵션이 원천 차단한다. 계약 타입을 앱 전역에서 import하는 이 구조에서 **필수**. |
| `moduleResolution` | **`bundler`** | Vite(번들러) 해석 규칙과 동일. 확장자 없는 상대 import와 `exports` 필드를 정확히 해석한다. `node16`은 확장자 명시를 강제해 번들러 환경에 부적합. |
| `module` / `target` | `ESNext` / `ES2022` | 최신 브라우저 대상, 다운레벨 불필요. |
| `jsx` | `react-jsx` | 클래식 런타임 불필요. |
| `noEmit` | **`true`** | 빌드는 Vite(esbuild)가 담당, `tsc`는 **검사 전용**. |
| `noFallthroughCasesInSwitch` | `true` | `kind` 판별 유니온 `switch`의 fallthrough 사고 차단. |
| `noImplicitOverride`, `forceConsistentCasingInFileNames`, `skipLibCheck` | `true` | 각각 상속 오류·Windows 대소문자 사고·서드파티 타입 잡음 방지. |
| `isolatedModules` | `true` | esbuild 파일 단위 트랜스파일과의 정합성 보장. |
| `paths` | `{"@/*": ["./src/*"]}` | 상대경로 지옥 방지. **`vite.config.ts`의 `resolve.alias`와 반드시 동일하게 유지**(불일치 시 dev는 되고 테스트가 깨진다). |

---

## 3. 디렉터리 구조 및 역할별 쓰기 소유권

### 3.1 경로 트리

```
D:\dev\trickal-shooting\
├─ README.md                          [문서]
├─ .gitignore                         [FE-DEV]  (현재 저장소에 없음 — 스캐폴딩 시 필수 생성)
├─ package.json                       [FE-DEV]
├─ package-lock.json                  [FE-DEV]  (커밋 필수)
├─ index.html                         [FE-DEV]
├─ vite.config.ts                     [FE-DEV]  (Vite + Vitest 통합, alias, 포트 고정)
├─ vitest.setup.ts                    [FE-DEV]  (jest-dom + canvas 스텁)
├─ tsconfig.json                      [FE-DEV]  (§2.2 — src/tests/e2e)
├─ tsconfig.node.json                 [FE-DEV]  (§2.2 — *.config.ts)
├─ eslint.config.ts                   [FE-DEV]
├─ .prettierrc                        [FE-DEV]
├─ playwright.config.ts               [E2E]
│
├─ src\
│  ├─ contracts\                      ★★ [TECH-LEAD 전용] 타입 선언만, 런타임 코드 0줄 (§5)
│  │  ├─ index.ts                     계약 배럴(barrel) — 앱은 `@/contracts`로만 import
│  │  ├─ entities.ts                  Entity 판별 유니온, Player/Enemy/RegularProjectile/SkillProjectile, Box
│  │  ├─ world.ts                     GameWorld, GameSession, SpawnerState, GameStatus
│  │  ├─ systems.ts                   각 시스템 함수 시그니처 타입 + 모듈 배치 주석
│  │  ├─ ui.ts                        컴포넌트 Props, HudSnapshot, HudStore, TestBridge
│  │  └─ balance.ts                   BalanceConfig 타입(값 아님)
│  │
│  ├─ types\
│  │  └─ global.d.ts                  [FE-DEV] `declare global` (Window.__TRICKAL_TEST__ 등)
│  ├─ vite-env.d.ts                   [FE-DEV] Vite 클라이언트 타입 참조
│  │
│  ├─ main.tsx                        [FE-DEV] React 진입점
│  ├─ App.tsx                         [FE-DEV] 루트 + Error Boundary
│  ├─ index.css                       [FE-DEV] 전역 스타일 (최소)
│  │
│  ├─ ui\                             [FE-DEV] ── React 계층 (DOM만)
│  │  ├─ GameBoard.tsx                캔버스 + HUD 컴포지션, 루프 마운트
│  │  ├─ Hud.tsx                      HP/MANA/SCORE/LEVEL 표시
│  │  ├─ GameCanvas.tsx               <canvas> + ref + DPR 스케일링
│  │  └─ ErrorFallback.tsx            루프 크래시 폴백 UI
│  │
│  ├─ hooks\                          [FE-DEV] ── React ↔ 엔진 접착
│  │  ├─ useGameLoop.ts               rAF 구동/정리, dt 산출
│  │  ├─ useKeyboardInput.ts          DOM 키 이벤트 → InputState
│  │  └─ useHudSnapshot.ts            useSyncExternalStore 구독
│  │
│  ├─ game\                           [FE-DEV] ── 순수 로직 (DOM/Canvas 참조 금지)
│  │  ├─ balance.ts                   모든 튜닝 상수 값 (§6.6)
│  │  ├─ createWorld.ts               초기 월드 팩토리
│  │  ├─ stepWorld.ts                 1 시뮬레이션 틱 오케스트레이션
│  │  ├─ rng.ts                       시드 기반 결정적 난수
│  │  ├─ input.ts                     InputState 생성/정규화
│  │  ├─ hudStore.ts                  HUD 스냅샷 발행 스토어 (§6.1)
│  │  └─ systems\
│  │     ├─ movement.ts  spawner.ts  collision.ts
│  │     └─ combat.ts    weapon.ts   progression.ts
│  │
│  ├─ render\                         [FE-DEV] ── 캔버스 출력 (상태 변경 금지)
│  │  ├─ palette.ts                   그레이박스 팔레트 (§6.7)
│  │  ├─ drawScene.ts                 1프레임 그리기
│  │  └─ drawEntity.ts                엔티티 1개 (★ 스프라이트 교체 지점)
│  │
│  └─ testBridge.ts                   [FE-DEV] E2E 관측 브릿지 (?e2e=1 게이팅, §6.9)
│
├─ tests\                             [FE-QA 전용]
│  ├─ unit\*.test.ts                  순수 로직 (environment: node)
│  ├─ component\*.test.tsx            React 컴포넌트 (environment: jsdom)
│  └─ helpers\*.ts                    타입 붙은 픽스처 빌더
│
└─ e2e\                               [E2E 전용]
   ├─ *.spec.ts
   └─ fixtures\
```

### 3.2 쓰기 소유권 표 (경로 충돌 없음)

| 에이전트 | **쓰기 허용 경로** | 쓰기 금지 | 읽기 |
| --- | --- | --- | --- |
| `system-architect` | `.claude/_workspace/01_architecture/**` | 그 외 전부 | 저장소 전체 |
| `issue-pm` | `.claude/_workspace/02_issues/**` | 그 외 전부 | `01_architecture` |
| `tech-leader` | `.claude/_workspace/03_contracts/**` **+ `src/contracts/**` (★ 본 설계서가 부여한 확장 권한, §5.2)** | 그 외 전부 (`src/contracts/` 외의 `src/**` 포함) | `01_architecture`, `02_issues` |
| `frontend-developer` | `src/**` **단 `src/contracts/**` 제외**, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `vitest.setup.ts`, `tsconfig.json`, `tsconfig.node.json`, `eslint.config.ts`, `.prettierrc`, `.gitignore` | `src/contracts/**`, `tests/**`, `e2e/**`, `playwright.config.ts`, `.claude/**` | 전체 |
| `frontend-qa` | `tests/**` | `src/**` 전체, 루트 설정 파일, `e2e/**`, `.claude/**` | `01_architecture`, `02_issues`, `03_contracts`, **`src/contracts/**`(★ 허용 — 선언만 존재하므로 클린룸 유지)**. 그 외 `src/**` 열람 금지 |
| `e2e-tester` | `e2e/**`, `playwright.config.ts` | `src/**`, `tests/**`, `package.json`, `.claude/**` | 전체 |
| `code-reviewer` | (쓰기 없음, 리뷰는 SendMessage) | 전부 | 전체 |

> **경합 해소 규칙**
> 1. **`src/contracts/**`는 `tech-leader` 단독 소유다.** `frontend-developer`는 이 디렉터리를 생성·수정·삭제하지 않는다(스캐폴딩 시 이미 존재하면 그대로 둔다). 계약 변경이 필요하면 SendMessage로 개정 요청한다.
> 2. `playwright.config.ts`는 `e2e-tester` 소유지만, `package.json`의 `e2e` 스크립트와 `@playwright/test` 의존성은 `frontend-developer`가 스캐폴딩 시 미리 넣는다(§4.1). e2e-tester는 `package.json`을 수정하지 않는다.
> 3. `vitest.setup.ts`·`tsconfig*.json`은 **테스트/타입 하네스 인프라**이므로 `frontend-developer` 소유다. QA·E2E는 수정하지 않고 요청만 한다.
> 4. `src/game/**`에 색상 관련 모듈을 만들지 않는다(색상은 렌더 계층 전용, §6.7).

---

## 4. 표준 명령어

> 모든 명령은 **저장소 루트**(`D:\dev\trickal-shooting`)에서 실행한다. 셸 종속 문법을 쓰지 않는다.

| 목적 | 명령 | 실행 주체 |
| --- | --- | --- |
| 의존성 설치 | `npm install` | frontend-developer(최초), 필요 시 전원 |
| 개발 서버 | `npm run dev` — **포트 5173 고정** | frontend-developer |
| **정적 타입 검사** | `npm run typecheck` → `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json` | **전원 (게이트 필수)** |
| 프로덕션 빌드 | `npm run build` → `npm run typecheck && vite build` | frontend-developer, e2e-tester |
| 빌드 미리보기 | `npm run preview` — **포트 4173 고정** | e2e-tester |
| 전체 테스트(1회) | `npm test` → `vitest run` | frontend-qa, frontend-developer |
| 감시 모드 | `npm run test:watch` → `vitest` | frontend-developer |
| 순수 로직만 | `npm run test:unit` → `vitest run tests/unit` | frontend-qa, frontend-developer |
| 컴포넌트만 | `npm run test:component` → `vitest run tests/component` | frontend-qa, frontend-developer |
| 커버리지 | `npm run test:coverage` → `vitest run --coverage` | code-reviewer |
| 린트 | `npm run lint` → `eslint .` | frontend-developer, code-reviewer |
| 린트 자동수정 | `npm run lint:fix` → `eslint . --fix` | frontend-developer |
| 포맷 검사 | `npm run format:check` → `prettier --check .` | code-reviewer |
| 포맷 적용 | `npm run format` → `prettier --write .` | frontend-developer |
| E2E 브라우저 설치 | `npx playwright install chromium` (최초 1회) | e2e-tester |
| E2E 실행 | `npm run e2e` → `playwright test` | e2e-tester |
| E2E 증거 열람 | `npm run e2e:report` → `playwright show-report` | e2e-tester |

### 4.1 `package.json` 필수 scripts 키 (frontend-developer 이행 의무)
```
dev, build, preview, typecheck, test, test:watch, test:unit, test:component,
test:coverage, lint, lint:fix, format, format:check, e2e, e2e:report
```
> 15개 키가 모두 존재해야 한다. 하나라도 없으면 `code-reviewer`는 반려한다. `"type": "module"` 설정 필수.

### 4.2 계약 검증 명령 (Phase 2 — `npm install` 이전 시점) **재검토 결과**

`tech-leader`는 Phase 2에서 `src/contracts/**`를 작성하는데, 이 시점에는 아직 `package.json`도 `node_modules`도 없다(스캐폴딩은 Phase 3). 따라서 **두 단계로 검증**한다.

| 시점 | 명령 | 비고 |
| --- | --- | --- |
| **Phase 2** (tech-leader) | `npx --yes typescript@5.7 tsc --noEmit --strict --target ES2022 --lib ES2022 --moduleResolution bundler --module ESNext src/contracts/*.ts` | 계약 파일이 **어떤 외부 타입에도 의존하지 않도록**(§5.3 규칙) 설계했기 때문에 `@types/*` 없이 독립 검증이 가능하다. DOM 타입도 불필요(`Window` 확장은 `src/types/global.d.ts`가 담당). |
| **Phase 3 이후** (전원) | `npm run typecheck` | 계약 + 구현 + 테스트 + E2E를 한 번에 검사. 계약 이탈은 여기서 빌드 실패로 드러난다. |

### 4.3 ESLint flat config 구성 (frontend-developer 이행 의무)
`eslint.config.ts`는 다음을 포함한다.
- `@eslint/js` recommended + `typescript-eslint` **`recommendedTypeChecked`** (타입 인지 규칙 활성화, `languageOptions.parserOptions.projectService: true`)
- `eslint-plugin-react-hooks` recommended (**`react-hooks/exhaustive-deps`를 error로 승격** — 게임 루프의 stale closure 사고 차단)
- `eslint-plugin-react-refresh`
- `eslint-config-prettier` **마지막**에 배치
- 프로젝트 전용 규칙(모두 `error`):
  `@typescript-eslint/no-explicit-any`, `no-unsafe-assignment/-call/-member-access/-return`, `@typescript-eslint/consistent-type-imports`, `@typescript-eslint/no-unnecessary-condition`, `@typescript-eslint/switch-exhaustiveness-check`, `no-console`(warn/error만 허용)
- `ignores`: `dist`, `coverage`, `playwright-report`, `test-results`, `node_modules`

### 4.4 게이트 기준
- **FE 구현 완료 게이트:** `npm run lint` + `npm run typecheck` + `npm test` 전부 통과
- **E2E 게이트:** `npm run build` 성공 후 `npm run e2e` 전부 통과 (Playwright `webServer`가 `npm run preview` 자동 기동)
- **타입 에러는 경고가 아니라 실패다.** `@ts-expect-error`나 `as unknown as`로 무마한 채 게이트를 통과시키지 않는다.

---

## 5. 계약 산출 형식 (재설계) — ★ 핵심 결정

### 5.1 채택안: **(a) `tech-leader`가 실제 타입 소스를 직접 소유·작성한다**

**결정:** `tech-leader`가 `src/contracts/**`에 **실제 TypeScript 타입 소스 파일을 직접 작성·소유**하고, `frontend-developer`는 그 타입을 **구현만** 한다. `03_contracts/`에 타입을 복제해 두는 이중화(b안)는 폐기한다.

**근거**
1. **계약 위반이 문서 리뷰가 아니라 컴파일 에러가 된다.** b안(복사·동기화)은 복사 시점에 계약이 원본과 갈라질 수 있고, 갈라졌는지 아무도 기계적으로 확인할 수 없다. a안은 앱이 계약 파일을 직접 import하므로 **드리프트가 구조적으로 불가능**하다.
2. **중복 산출물 제거.** b안은 같은 타입을 `.claude/`와 `src/`에 두 벌 유지해야 하며, 이는 그레이박싱처럼 계약이 자주 바뀌는 단계에서 가장 먼저 썩는 지점이다.
3. **클린룸 TDD가 깨지지 않는다.** `src/contracts/**`는 **선언만 있고 구현이 0줄**이므로, `frontend-qa`가 이 디렉터리를 읽어도 "구현을 보고 테스트를 맞추는" 위험이 없다. 오히려 QA가 가장 정확한 명세를 얻는다.
4. **권한 충돌은 경로 분리로 해소된다.** `src/contracts/`를 tech-leader 단독 소유로 못 박고, frontend-developer의 `src/**` 권한에서 이 경로를 명시적으로 제외했다(§3.2).

**에이전트 정의와의 관계 (명시적 오버라이드)**
> `tech-leader`의 에이전트 정의는 쓰기 범위를 `.claude/_workspace/03_contracts/` 하위로 제한하고 "프로덕션 코드 작성 금지"를 규정한다. **본 설계서는 이를 다음과 같이 확장·해석한다.**
> - `src/contracts/**`는 **타입 선언 전용 산출물**이며 §5.3의 「런타임 코드 0줄」 규칙에 의해 **컴파일 결과 JavaScript를 단 1바이트도 생성하지 않는다.** 따라서 "프로덕션 코드"가 아니라 **계약 파일**이다.
> - `tech-leader`는 이 경로에 대해서만 `src/` 쓰기가 허용되며, 그 외 `src/**`에는 여전히 접근하지 않는다.
> - 이 오버라이드는 본 설계서의 서두 규칙("본 문서가 에이전트 정의의 일반 규정보다 우선한다")에 근거한다.

### 5.2 `tech-leader`의 산출물 목록 (경로 고정)

| 파일 | 성격 | 내용 |
| --- | --- | --- |
| `src/contracts/entities.ts` | **타입 소스(SSOT)** | `EntityKind`, `Box`, `EntityBase`, `Player`, `Enemy`, `RegularProjectile`, `SkillProjectile`, `Entity` 판별 유니온 |
| `src/contracts/world.ts` | 타입 소스 | `GameStatus`, `GameSession`, `SpawnerState`, `GameWorld`, `InputState`, `Rng` |
| `src/contracts/systems.ts` | 타입 소스 | 각 시스템 함수 시그니처 타입(`StepWorld`, `AabbOverlap`, `SpawnTick` 등) + **각 타입이 어느 모듈 파일에 구현되는지 JSDoc `@module`로 명시** |
| `src/contracts/ui.ts` | 타입 소스 | `HudSnapshot`, `HudStore`, 컴포넌트 Props, `TestBridge` |
| `src/contracts/balance.ts` | 타입 소스 | `BalanceConfig` **타입만**(실제 수치 값은 `src/game/balance.ts`가 FE-DEV 소유로 보유) |
| `src/contracts/index.ts` | 배럴 | 위 전부 re-export. **앱·테스트는 `@/contracts`에서만 import한다.** |
| `.claude/_workspace/03_contracts/invariants.md` | 산문 명세 | 타입으로 표현 **불가능한** 것: 불변식, 실행 순서, 경계 조건, 수용 기준. **§6.2.1의 `INV-MOVE-1/2`, `INV-FIRE-1`, `INV-SPAWN-1`, `INV-DMG-1`을 반드시 포함**한다. |
| `.claude/_workspace/03_contracts/ui-contracts.md` | 산문 명세 | HUD 표시 문자열 포맷, `data-testid` 목록, **키 바인딩 표(§6.2.1-(1), 이동·스킬·재시작 의미 입력 6종)**, 게임오버 오버레이 문구·재시작 키, E2E 브릿지 사용 규약 |
| `.claude/_workspace/03_contracts/module-map.md` | **슬림화된 매핑표** | §5.5 참조 |

### 5.3 `src/contracts/**` 작성 규칙 (위반 시 반려)

1. **런타임 코드 0줄.** `type` / `interface` 선언과 `export type { ... }` 만 허용한다. `const`·`function`·`class`·`enum`·`as const` 객체 등 **값(value)을 만드는 모든 구문 금지**. → 컴파일 산출물이 빈 파일이 되므로 번들 영향이 0이며, "계약은 프로덕션 코드가 아니다"라는 §5.1의 전제가 기계적으로 성립한다.
2. **외부 의존 0.** `react`, `@types/*`, DOM 타입, 다른 `src/` 모듈을 import하지 않는다(계약 파일끼리의 `import type`만 허용). → §4.2의 독립 검증이 가능해진다. React Props 타입이 필요하면 `children?: unknown` 대신 **필요한 필드만 직접 선언**하고, React 특화 타입(`ReactNode` 등)은 `src/ui/`에서 조합한다.
3. **`any` 금지**, 인덱스 시그니처 남용 금지, 옵셔널 남용 금지. 유한 집합은 **리터럴 유니온**으로 표현한다.
4. **`enum` 금지.** (`verbatimModuleSyntax`/`isolatedModules`와 상성이 나쁘고 값을 생성한다.)
5. 모든 수치 필드에 **단위를 JSDoc으로 명시**한다. 예: `/** px/sec */ speed: number;`
6. 불변이 자연스러운 구조는 `readonly` / `Readonly<>` / `readonly T[]`로 선언한다(§6.5).
7. 인자 변형 여부를 JSDoc `@mutates`로 명시한다. 예: `/** @mutates world */`
8. `strict` 단독 검증을 통과해야 한다(§4.2).

### 5.4 `frontend-developer`의 준수 의무
- 구현 모듈은 계약 타입을 **직접 import**해 시그니처를 고정한다.
  예: `import type { AabbOverlap } from '@/contracts';` → `export const aabbOverlap: AabbOverlap = (a, b) => { ... }`
  (이 패턴이면 인자·반환 타입이 계약에 **자동 결박**되어 이탈이 컴파일 에러가 된다. **함수 시그니처를 손으로 다시 적지 않는다.**)
- 계약에 없는 공개 API를 임의로 추가하지 않는다. 필요하면 tech-leader에게 개정 요청.
- **구현 편의를 위해 계약을 느슨하게 만드는 것은 금지**한다.

### 5.5 `module-map.md`는 계속 필요한가 — **필요하다. 단 슬림화한다.**

TypeScript가 표현하지 못하는 정보가 정확히 하나 남는다: **"어느 타입이 어느 파일에 어떤 이름으로 구현되는가"** (즉 타입 ↔ 물리적 모듈 배치의 결박). `frontend-qa`는 `src/game/**`을 열람할 수 없으므로 import 경로를 알 방법이 이 표뿐이다.

→ **시그니처 재기술은 삭제하고**(계약 파일에 있으므로 중복), 아래 5개 컬럼만 남긴다.

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| `@/game/systems/collision` | `aabbOverlap` | `AabbOverlap` | `pure` | `node` |
| `@/game/stepWorld` | `stepWorld` | `StepWorld` | `mutates-arg(world)` | `node` |
| `@/game/hudStore` | `hudStore` | `HudStore` | `impure(모듈 싱글턴 상태)` | `node` |
| ... | ... | ... | ... | ... |

---

## 6. 아키텍처 규약 (Architecture Conventions)

### 6.0 계층 분리 원칙 (최상위 규약)

```
[src/contracts/**]  타입만 (TECH-LEAD)    ← 런타임 코드 0줄, 모든 계층이 참조
        ↑ import type
[ui/*.tsx]   React·DOM만          ← 게임 로직 금지, ctx 직접 호출 금지
    ↕
[hooks/*.ts] 접착 계층            ← rAF/이벤트리스너/ref 관리, 로직 위임만
    ↕
[game/**]    순수 로직            ← ★ DOM·Canvas·window·Date·Math.random 참조 전면 금지
    ↓ (읽기 전용)
[render/**]  캔버스 출력          ← ctx 호출만. 월드 상태를 절대 변형하지 않음
```

**강제 규칙**
1. `src/game/**` 안에서 `document`, `window`, `canvas`, `CanvasRenderingContext2D`, `Date.now()`, `performance.now()`, `Math.random()` 사용을 **금지**한다. 시간과 난수는 **인자로 주입**받는다.
2. `src/render/**`의 함수는 월드를 **읽기만** 한다. 시그니처에서 `Readonly<GameWorld>` / `readonly Enemy[]`로 받아 **타입 레벨에서 변형을 차단**한다.
3. `src/ui/**`는 `game/`의 함수를 직접 호출하지 않고 반드시 `hooks/`를 경유한다.
4. → 결과적으로 `src/game/**`은 **jsdom 없이 `environment: node`에서 100% 단위 테스트 가능**해야 한다. 이것이 이번 설계의 존재 이유다.

### 6.1 게임 루프와 React 렌더링의 경계 (★ 유지 — v2.0과 동일)

**문제:** `requestAnimationFrame` 루프가 매 프레임 `setState`를 호출하면 초당 60회 리렌더가 발생해 프레임이 붕괴한다.

| 상태 종류 | 저장 위치 | 갱신 주체 | React 리렌더 |
| --- | --- | --- | --- |
| **월드 상태** (엔티티 배열, 좌표, 쿨다운, 타이머, RNG 시드) | `useRef<GameWorld>`가 보유하는 **가변 객체** (`createWorld()` 반환값) | 게임 루프가 매 틱 직접 변형 | **절대 발생시키지 않음** |
| **입력 상태** (눌린 키 집합) | `useRef<InputState>` | DOM 이벤트 핸들러가 직접 변형 | 발생시키지 않음 |
| **HUD 스냅샷** (`hp`, `maxHp`, `mana`, `score`, `level`, `status`) | `game/hudStore.ts` 모듈 스토어 | 루프가 **스로틀 + 변경 감지** 후 발행 | 값이 실제로 바뀔 때만 |

**HUD 동기화 상세**
- `HudStore` 계약: `{ subscribe(cb: () => void): () => void; getSnapshot(): Readonly<HudSnapshot>; publish(next: HudSnapshot): void; reset(): void }` — **프레임워크 비의존 모듈**(node 환경 단위 테스트 가능).
- `publish(next)`는 **얕은 비교**로 이전 스냅샷과 다를 때만 새 객체를 저장하고 통지한다. 동일하면 아무 일도 하지 않는다. → `getSnapshot()`이 항상 캐시된 **동일 참조**를 반환하므로 `useSyncExternalStore`의 무한 루프/티어링이 원천 차단된다.
- 게임 루프는 **최대 10Hz(100ms 간격)** 로만 `publish`를 시도한다. 상수 `HUD_PUBLISH_INTERVAL_MS`는 `balance.ts`에 둔다.
- 단, **`status` 전이(`playing → gameover` 등)는 스로틀을 무시하고 즉시 발행**한다.
- `Hud.tsx`는 `useHudSnapshot()` → `useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot, hudStore.getSnapshot)`로 구독한다(3번째 인자로 SSR/초기 렌더 안전성 확보).
- 결과: 최악의 경우에도 리렌더는 **초당 10회 이하**, 실제로는 값이 변할 때만 발생한다.

**루프 수명주기 (`useGameLoop.ts`)**
- `useEffect`는 **의존성 `[]`** 로 1회만 마운트, cleanup에서 반드시 `cancelAnimationFrame`.
- 최신 값이 필요하면 state 캡처 대신 **ref 경유**로 읽는다(stale closure 방지). `react-hooks/exhaustive-deps` 경고를 주석으로 무시하지 않는다(§4.3에서 error).
- `document.visibilitychange`로 탭이 숨겨지면 루프 정지, 복귀 시 **누적 시간을 버리고** 재개(복귀 직후 dt 폭주에 의한 터널링 방지).
- StrictMode 이중 마운트에서도 루프가 2개 돌지 않도록 cleanup을 완전하게 작성한다.

### 6.2 deltaTime 및 시뮬레이션 스텝 규약 (★ 유지)

**확정: 고정 타임스텝 + 누산기(accumulator).**

```ts
// 매 rAF 프레임 (의사코드)
let elapsedMs = now - lastTime;                  // now는 rAF 콜백 인자 사용
elapsedMs = Math.min(elapsedMs, MAX_FRAME_MS);   // 250ms 클램프
accumulator += elapsedMs;
let substeps = 0;
while (accumulator >= FIXED_STEP_MS) {           // FIXED_STEP_MS = 1000 / 60
  stepWorld(world, input, FIXED_DT_SEC, rng);    // FIXED_DT_SEC = 1 / 60
  accumulator -= FIXED_STEP_MS;
  if (++substeps >= MAX_SUBSTEPS) { accumulator = 0; break; }  // MAX_SUBSTEPS = 5
}
drawScene(ctx, world);
```

**근거:** 가변 dt를 그대로 물리에 곱하면 프레임률에 따라 충돌 결과가 달라져 **테스트가 재현 불가능**해진다. 고정 스텝은 프레임률 독립성과 결정성을 동시에 확보한다.

**부속 규칙**
- `StepWorld` 계약: `(world: GameWorld, input: Readonly<InputState>, dt: number, rng: Rng) => void` — **시간·난수 100% 인자 주입**.
- 모든 속도/가속도 상수는 **초 단위(px/sec, /sec)**. 프레임 단위 상수 금지.
- 모든 쿨다운/타이머는 **잔여 초**로 저장하고 `-= dt`로 감소.
- `rng`는 `game/rng.ts`의 **시드 기반 결정적 생성기**(mulberry32 등). `fireWeapon`은 실제 스킬탄을 생성할 때 1회 소비해 초기 Y축 확산을 정하고, 그 뒤 `spawnTick`이 필요한 경우 소비한다. 탄종 상한으로 생성을 생략한 경우에는 소비하지 않는다. 테스트는 고정 시드를 주입해 발사 궤적과 스폰 순서를 재현한다.
- 테스트는 rAF 없이 `stepWorld`를 N회 직접 호출한다(`tests/helpers/`에 `advance(world, seconds)` 헬퍼 권장).

### 6.2.1 입력·이동·경계·난이도 규약 (§9 확정 사양의 구현 규격)

> §9의 D-1 ~ D-6을 시뮬레이션 계층 규약으로 옮긴 것이다. `tech-leader`는 이 내용을 `invariants.md`(불변식)와 `ui-contracts.md`(키 바인딩)로 고정한다.

#### (1) 키 바인딩 (D-1 / D-2 / D-6) — `ui-contracts.md`에 고정

| 동작 | 키 | 비고 |
| --- | --- | --- |
| 위로 이동 | `ArrowUp` / `KeyW` | |
| 아래로 이동 | `ArrowDown` / `KeyS` | |
| **왼쪽으로 이동** | `ArrowLeft` / `KeyA` | **8방향 확정으로 신설** |
| **오른쪽으로 이동** | `ArrowRight` / `KeyD` | **8방향 확정으로 신설** |
| 스킬 발사 유지 | `Space` | MANA 20 이상에서 시작, 누르는 동안 유지(D-2/D-3) |
| 재시작 | `KeyR` | `status === 'gameover'` 일 때만 유효(D-6) |

- 키 식별은 레이아웃 의존적인 `event.key`가 아니라 **`event.code`** 를 사용한다(한/영 전환·비 QWERTY 환경에서도 동작).
- `InputState`는 **의미 단위 boolean 집합**(`up`/`down`/`left`/`right`/`skill`/`restart`)으로 정규화해 보관한다. 일반탄은 자동 발사이고 `skill`만 사용자 입력이다. **DOM 키 코드는 `hooks/useKeyboardInput.ts`에서만 다루고 `game/**`에는 절대 넘기지 않는다**(§6.0 규칙 1).
- `Space`와 방향키의 브라우저 기본 스크롤 동작을 `preventDefault`로 차단한다.
- 창 포커스 상실(`blur`) 시 `InputState`를 **전부 false로 초기화**한다(키가 눌린 채 고착되는 사고 방지).

#### (2) 대각선 이동 속도 정규화 (D-1) — **필수 불변식**

8방향 이동에서 좌우·상하 입력을 단순 합산하면 대각선 속도가 `√2 ≈ 1.414`배가 되어 대각선 이동이 유리해지는 고전적 버그가 발생한다. 다음을 강제한다.

```
dx = (right ? 1 : 0) - (left ? 1 : 0)      // -1 | 0 | 1
dy = (down  ? 1 : 0) - (up   ? 1 : 0)      // -1 | 0 | 1
len = Math.hypot(dx, dy)
if (len > 0) {
  x += (dx / len) * PLAYER_SPEED * dt      // 정규화 후 속도 적용
  y += (dy / len) * PLAYER_SPEED * dt
}
```
- **불변식 INV-MOVE-1:** 어떤 입력 조합에서도 1틱 이동 거리는 `PLAYER_SPEED * dt`를 초과하지 않는다.
- 반대 방향 동시 입력(`left && right`)은 `dx = 0`으로 상쇄되며, 이는 정상 동작이다.
- 이 규칙은 `game/systems/movement.ts`의 순수 함수에 있으므로 **좌표 계산만으로 단위 테스트**한다(대각선 입력 시 이동 거리가 직선 입력과 동일한지 검증).

#### (3) 플레이어 경계 클램프 (D-1) — **필수 불변식**

캔버스 전역을 이동하므로 **x·y 양축 모두** 클램프한다(기존 y축만 클램프하던 전제는 폐기).

```
player.x = clamp(player.x, 0, bounds.width  - player.width)
player.y = clamp(player.y, 0, bounds.height - player.height)
```
- **불변식 INV-MOVE-2:** 어떤 틱에서도 플레이어의 AABB는 `bounds` 내부에 완전히 포함된다.
- 클램프는 **이동 적용 직후 같은 틱 안에서** 수행한다(다음 틱으로 넘기지 않는다).

#### (4) 투사체 발사 (D-2)

- `GameWorld`는 `regularProjectiles`와 `skillProjectiles`를 별도 배열로 보유하고, 타입도 `RegularProjectile`과 `SkillProjectile`로 분리한다. 이동·충돌 결과·전투·렌더 순회는 두 경로를 합치지 않는다.
- `Player`는 `regularFireCooldownRemainSec`, `skillFireCooldownRemainSec`, `isSkillFiring`을 보유한다. 두 쿨다운은 매 고정 틱 감소하므로 모드 전환 시 준비된 탄종은 즉시 발사할 수 있다.
- 일반 상태에서는 첫 플레이 틱부터 `0.3초`마다 일반탄을 자동 발사하고 MANA를 초당 `0.5` 회복한다. MANA는 `100`을 넘지 않는다.
- `input.skill`이 true이고 MANA가 `20` 이상이면 스킬 모드를 시작한다. 시작 후에는 MANA가 20 미만이어도 Space를 누르고 MANA가 남아 있는 동안 유지한다.
- 스킬 모드에서는 일반탄을 생성하지 않고 `0.15초`마다 스킬탄만 생성하며 MANA를 초당 `30` 소모한다. Space를 놓거나 MANA가 `0`이 되면 모드를 종료하고 일반탄 자동 발사를 재개한다.
- 각 탄종은 플레이어 오른쪽 가장자리의 세로 중앙에서 생성한다. 일반탄은 항상 +x로 직진한다.
- 스킬탄은 생성할 때 `targetId = null`, `vx = skillProjectile.speed`, `vy = (rng() - 0.5) * 2 * skillProjectile.initialSpreadSpeedY`로 초기 관성을 받고, 해당 시점의 `farTurnFactor`, `nearTurnFactor`, `nearTurnDistancePx`를 엔티티에 캡처한다. `Math.random()`은 사용하지 않는다.
- 스킬탄은 `targetId`와 일치하는 살아 있는 적이 있으면 거리 순위와 무관하게 그 대상을 계속 추적한다. 락온 대상이 없거나 죽어 사라졌을 때만 중심 거리 제곱이 가장 작은 살아 있는 적을 재획득하고 그 ID를 저장한다. 동률이면 `enemies` 배열에서 앞선 적을 선택한다.
- 목표가 있으면 목표 중심을 향하는 크기 `skillProjectile.speed`의 이상 속도(`desiredVx`, `desiredVy`)를 구한다. 두 중심 사이 실제 거리가 `nearTurnDistancePx`보다 작으면 `nearTurnFactor`, 그 외에는 `farTurnFactor`를 선택해 `velocity += (desiredVelocity - velocity) * turnFactor`로 현재 속도를 한 번만 보간한다. 보간 결과는 다시 `skillProjectile.speed`로 정규화한 뒤 위치에 적용한다. 보간 벡터의 크기가 0 또는 비유한 값이면 이상 속도로 복구해 `NaN` 전파를 막는다.
- 살아 있는 목표가 없으면 `targetId = null`로 정리하고, 방향을 +x로 재설정하지 않은 채 현재 `vx`/`vy` 관성을 그대로 적용한다. 이후 목표가 생기면 그 시점부터 새 타깃을 락온하고 같은 점진 조향을 시작한다.
- 살아 있는 탄종별 개수가 각 `BalanceConfig.limits` 상한에 도달하면 해당 생성을 조용히 생략하고 해당 쿨다운을 리셋한다. 발사 요청은 버퍼링·큐잉하지 않는다.
- **불변식 INV-FIRE-1:** 한 틱에서는 활성 모드의 탄종만 최대 1개 생성한다. `isSkillFiring === true`인 모든 틱에서 새 일반탄 수는 0이다.
- **불변식 INV-MANA-1:** 모든 시스템 실행 후 MANA는 `[0, 100]`이며, 100에서 회복이나 일반탄 처치 보상이 추가되어도 100을 유지한다. 일반탄 처치만 `enemy.manaGain`을 지급하고 스킬탄 처치는 지급하지 않는다.

#### (5) 적 생성·소멸과 난이도 (D-4 / D-5) — ★ 8방향 확정에 따른 전제 재검토 결과

플레이어가 우측으로 전진할 수 있게 되었으므로 "플레이어는 좌측 고정"을 암묵 전제한 서술을 다음과 같이 **명시적으로 재정의**한다. 재검토 결과 **스폰·이탈·난이도 모델은 그대로 성립**하며, 대신 아래 항목을 추가로 못 박는다.

- **스폰 위치:** 적은 **화면 우측 바깥**(`x = bounds.width`, y는 rng로 결정)에서 생성된다. 플레이어의 현재 x좌표와 **무관하다**.
- **스폰 안전 규칙(신설, 8방향 확정의 직접 결과):** 플레이어가 우측 끝까지 전진할 수 있으므로 **스폰 지점과 플레이어가 겹친 채 생성되는 상황**이 가능해졌다. 적은 화면 밖(`x >= bounds.width`)에서 생성되므로 **생성 즉시 충돌하지 않는다**는 것을 불변식으로 고정한다.
  - **불변식 INV-SPAWN-1:** 스폰 직후 프레임에서 적의 AABB는 `bounds` 우측 경계 바깥에 있으며 플레이어와 겹치지 않는다.
- **이탈 판정(D-5):** 적이 **화면 좌측 경계를 완전히 벗어나면**(`enemy.x + enemy.width < 0`) 해당 적을 `alive = false`로 표시해 제거한다. 플레이어 HP·무적 시간·점수·MANA는 변경하지 않는다.
- **플레이어-적 접촉:** 플레이어가 우측으로 전진해 적과 직접 충돌할 수 있다. 이 경우도 **HP 1 감소 + 해당 적 제거**로 처리한다(§6.4의 `combat.ts` 책임).
  - **피격 무적 시간(신설, 8방향 확정의 직접 결과):** 8방향 이동 이전에는 플레이어가 적에게 스스로 돌진할 수 없어 접촉 피해가 사실상 발생하지 않았다. 이제는 플레이어가 적 무리에 파고들 수 있으므로, 무적 시간이 없으면 **접촉 1회에 HP 3이 한 프레임에 증발**한다. 따라서 피격 후 `PLAYER_INVULN_SEC` 동안 추가 피해를 받지 않는 **무적 시간을 도입한다**(무적 중 렌더는 `hitFlash` 팔레트로 표시).
  - **불변식 INV-DMG-1:** 임의의 `PLAYER_INVULN_SEC` 구간 안에서 직접 접촉으로 인한 플레이어 HP 감소는 최대 1이다. 적의 좌측 이탈은 피해 원인이 아니다.
- **난이도(D-4):** 점수가 임계값을 넘으면 레벨이 1 상승하고 **스폰 주기(초)가 단축**된다. 스폰 주기에는 **하한(`SPAWN_INTERVAL_MIN_SEC`)** 을 두어 무한 단축으로 인한 프레임 붕괴를 막는다(§6.10 성능 예산·엔티티 상한과 연동).

#### (6) 게임오버와 재시작 (D-6)

- `progression.ts`가 `hp <= 0`을 감지하면 `status`를 `'gameover'`로 전이하고, `hudStore.publish`는 **스로틀을 무시하고 즉시 발행**한다(§6.1).
- `status === 'gameover'` 이면 `stepWorld`는 시뮬레이션을 진행하지 않는다(렌더는 마지막 화면을 유지).
- `restart` 입력은 **`gameover` 상태에서만** 유효하며, `createWorld()` 재호출로 월드를 전체 재생성하고 `hudStore.reset()`을 호출한다. **월드 객체를 부분적으로 되돌리지 않는다**(잔여 상태 누수 방지).

### 6.3 엔티티 모델링 규약 — **공통 base interface + `kind` 판별 유니온 (병행)**

**결정:** 둘 중 택일이 아니라 **역할별로 나눈다.**

```ts
// src/contracts/entities.ts (형태 예시 — 실제 필드는 tech-leader 확정)
export interface Box { x: number; y: number; width: number; height: number }
export interface EntityBase extends Box { id: number; alive: boolean }

export interface Player            extends EntityBase { kind: 'player';            /* ... */ }
export interface Enemy             extends EntityBase { kind: 'enemy';             /* ... */ }
export interface RegularProjectile extends EntityBase { kind: 'regularProjectile'; /* ... */ }
export interface SkillProjectile   extends EntityBase { kind: 'skillProjectile';   /* targetId, vx, vy, farTurnFactor, nearTurnFactor, nearTurnDistancePx, ... */ }

export type Entity = Player | Enemy | RegularProjectile | SkillProjectile;
export type EntityKind = Entity['kind'];            // 파생 — 손으로 다시 적지 않는다
```

| 상황 | 사용할 타입 | 이유 |
| --- | --- | --- |
| 월드 보관·순회·종류별 분기 | **`Entity` 판별 유니온** | `switch (e.kind)`에서 `never` 소진 검사로 **종류 추가 시 갱신 누락을 컴파일 에러로** 잡는다(§2.1 언어 선정 근거 ①). |
| 충돌 판정 같은 범용 기하 연산 | **`Readonly<Box>`** (구조적 타입) | `aabbOverlap(a: Readonly<Box>, b: Readonly<Box>)` 처럼 **좌표·크기만** 받으면 좁히기 없이 어떤 엔티티에도 쓰이고, 테스트도 리터럴 객체 2개로 끝난다. |
| 렌더 디스패치 | `Readonly<Entity>` + `kind` 조회 | §6.7 |

**소진 검사 강제 패턴**
```ts
default: {
  const _exhaustive: never = entity;
  throw new Error(`unhandled entity kind: ${String(_exhaustive)}`);
}
```
`@typescript-eslint/switch-exhaustiveness-check` 규칙으로도 이중 방어한다(§4.3).

### 6.4 순수 로직 분리 규약

- `game/systems/*.ts`의 각 함수는 **하나의 관심사**만 처리하고, `stepWorld.ts`가 **정해진 순서**로 조립한다.
  권장 순서: `input 반영 → weapon(모드·MANA·발사, 스킬탄 생성 시 rng 소비) → movement(이동 + 플레이어 경계 클램프 + 적 좌측 이탈 + 탄종별 이동) → spawner(스폰, rng 소비) → collision(탄종별 판정) → combat(탄종별 보상/피해/사망/점수, 무적 시간 감소) → progression(MANA 포화/레벨/게임오버) → 죽은 엔티티 정리`
  이 순서는 `invariants.md`에 명문화하고 변경 시 계약 개정을 거친다.
  - **클램프는 `movement` 단계 안에서** 이동 적용 직후 수행한다(§6.2.1-(3)). 별도 시스템으로 분리하지 않는다.
  - **무적 시간(`invulnRemainSec`)·발사 쿨다운은 각 담당 시스템에서 `-= dt`** 로 감소시키며, 감소와 판정 순서를 `invariants.md`에 고정한다.
- **판정 함수는 부수효과가 없어야 한다.** `collision.ts`는 상태를 바꾸지 않고 **충돌쌍 목록만 반환**하고, 피해 적용은 `combat.ts`가 한다. → 충돌 판정을 좌표 몇 개로 단위 테스트할 수 있다.
- 성능을 위해 `stepWorld` 내부의 인플레이스 변형은 허용하되 **`@mutates`로 계약에 명시**한다. "순수"의 정의는 *같은 입력 → 같은 결과, 외부 세계 미참조*.
- 엔티티 제거는 순회 중 `splice` 하지 않고 **`alive = false` → 틱 말미 일괄 필터**로 처리한다(인덱스 붕괴 방지).
- **배열 접근 규약(`noUncheckedIndexedAccess: false`의 대가):** 순회는 `for...of` / `.forEach` / `.filter` / `.map` 을 기본으로 하고, 인덱스 직접 접근은 길이가 자명하게 보장된 구간으로 한정한다. `.find()` 등 `undefined` 가능 API의 결과는 **반드시 널 검사**한다. `arr[i]!` 형태의 non-null 단언은 **금지**(§6.5.3).

### 6.5 TypeScript 사용 규약

#### 6.5.1 `readonly` / `as const`
- **`balance.ts`(FE-DEV 소유, 값):**
  ```ts
  import type { BalanceConfig } from '@/contracts';
  export const BALANCE = { /* ... */ } as const satisfies BalanceConfig;
  ```
  - `as const`로 **깊은 리터럴 + readonly**를 얻고, `satisfies`로 계약 준수를 검사하되 **리터럴 타입을 잃지 않는다**(단순 `: BalanceConfig` 주석은 리터럴을 넓혀버리므로 금지).
  - **`Object.freeze`는 사용하지 않는다.** 얕은 freeze는 중첩 객체를 보호하지 못해 거짓 안전감만 준다. 불변성은 `as const`로 **컴파일 타임에** 보장하며, 이 값은 앱 전역에서 읽기 전용으로만 쓰인다.
- **`palette.ts`:** `as const satisfies Readonly<Record<PaletteToken, string>>`
- **읽기 전용 파라미터:** 상태를 바꾸지 않는 함수는 `Readonly<T>` / `readonly T[]`로 인자를 받는다(특히 `render/**` 전부, `collision.ts`).
- 계약의 필드 중 생성 후 불변인 것(`id`, `kind`, `bounds`)은 `readonly` 필드로 선언한다.

#### 6.5.2 `any` 금지 및 예외 절차
- **`any`는 전면 금지**(`@typescript-eslint/no-explicit-any`: error). 타입을 모르면 `unknown`으로 받고 **좁힌 뒤** 사용한다.
- 불가피한 예외는 **오케스트레이터 승인 후**에만 허용하며, 다음 3요소를 갖춰야 한다: ① 해당 라인에 `// eslint-disable-next-line` + **사유 주석**, ② 영향 범위를 함수 1개 이내로 격리, ③ `invariants.md`에 부채로 등재.
- `@ts-ignore` 금지. 불가피하면 `@ts-expect-error` + 사유 주석(수정되면 컴파일러가 알려준다).

#### 6.5.3 타입 단언(`as`) 허용 범위
| 허용 | `as const` / 리터럴 고정 |
| --- | --- |
| 허용 | **런타임 검증을 통과한 직후**의 좁히기 (예: `typeof` / `in` / 커스텀 타입가드 이후) |
| 허용 | 테스트 코드에서 `vi.fn()` 목 객체를 계약 인터페이스로 맞출 때 (`tests/helpers/`에 격리) |
| **금지** | `as unknown as T` (이중 단언) — 예외 없음 |
| **금지** | `!` non-null 단언 — 대신 널 가드 또는 조기 반환. `canvasRef.current`, `getContext('2d')`는 **반드시 null 체크**한다(원본 뼈대의 잠재 크래시 지점). |
| **금지** | 계약 타입을 우회하기 위한 단언 |

#### 6.5.4 기타
- `import type` 강제(`verbatimModuleSyntax` + `consistent-type-imports`).
- `enum`·`namespace` 금지(계약의 ambient 선언 필요 시에도 모듈 스코프 타입으로 표현).
- 파생 가능한 타입은 손으로 다시 적지 않는다(`EntityKind = Entity['kind']`, `PaletteToken = keyof typeof PALETTE`).

### 6.6 밸런스 상수 분리 규약 (★ 유지)

- **모든 튜닝 값은 `src/game/balance.ts` 단일 파일**에 모으고 §6.5.1의 `as const satisfies BalanceConfig` 패턴으로 export한다.
- **`src/game/**`, `src/hooks/**`, `src/ui/**` 어디에도 게임플레이 매직 넘버를 쓰지 않는다.** 하드코딩된 수치는 즉시 반려 사유(좌표 0, 배열 인덱스 등 구조적 상수는 예외).
- 모든 상수에 **단위를 JSDoc으로 병기**한다(`/** px/sec */`).
- 테스트는 balance 값을 하드코딩해 단정하지 않고 **balance 모듈을 import해 참조**한다. → 튜닝이 테스트를 깨뜨리지 않는다.

#### 6.6.1 `BalanceConfig` 필수 키 목록 (§9 확정 사양 기준 — `tech-leader`는 이 목록으로 타입을 정의한다)

> 아래는 **키와 단위의 확정 목록**이다. 수치(값)는 `frontend-developer`가 `src/game/balance.ts`에 채운다. **키를 임의로 빼거나 이름을 바꾸지 않는다.** 추가가 필요하면 계약 개정 절차를 따른다.

| 그룹 | 키 | 단위 | 근거 |
| --- | --- | --- | --- |
| `canvas` | `width`, `height` | px | 800 / 600 고정(§1.1) |
| `player` | `spawnX`, `spawnY` | px | 초기 배치 |
| | `width`, `height` | px | AABB 크기 |
| | `speed` | **px/sec** | D-1 8방향 이동 속도(정규화 후 적용) |
| | `maxHp` | 점 | HUD `♥ n / maxHp` |
| | `regularFireCooldownSec`, `skillFireCooldownSec` | **sec** | D-2 |
| | `skillStartMana` | % | D-2/D-3 스킬 시작 임계값 |
| | `manaRegenPerSec`, `skillManaDrainPerSec` | %/sec | D-3 일반 회복·스킬 소모 |
| | **`invulnSec`** | **sec** | **8방향 확정으로 신설** — 피격 무적 시간(INV-DMG-1) |
| `regularProjectile` | `width`, `height` | px | 일반탄 AABB |
| | `speed`, `damage`, `lifetimeSec` | px/sec, 점, sec | +x 직진 일반탄 |
| `skillProjectile` | `width`, `height` | px | 스킬탄 AABB |
| | `speed`, `initialSpreadSpeedY`, `damage`, `lifetimeSec` | px/sec, px/sec, 점, sec | 락온 관성 유도 스킬탄 |
| | `farTurnFactor`, `nearTurnFactor` | 0~1 무차원/고정 틱 | 원거리 점진 조향·근거리 오버슈팅 방지 보간 계수 |
| | `nearTurnDistancePx` | px | 근접 회전 부스트를 적용하는 중심 거리의 엄격한 상한 |
| `enemy` | `width`, `height` | px | |
| | `speed` | px/sec | D-5 좌측 직진(x 감소) |
| | `hp` | 점 | |
| | `scoreValue` | 점 | 처치 시 가산 점수 |
| | `manaGain` | % | D-3 처치 시 마나 누적량 |
| | `contactDamage` | 점 | 플레이어 접촉 피해 |
| `spawn` | `initialIntervalSec` | sec | D-4 초기 스폰 주기 |
| | `intervalDecayPerLevel` | sec 또는 비율 | D-4 레벨당 주기 단축량 |
| | `minIntervalSec` | sec | 하한(§6.2.1-(5)) |
| | `marginY` | px | 상하 스폰 여백 |
| `progression` | `manaMax` | % | D-3 (=100) |
| | `levelUpScoreStep` | 점 | D-4 레벨업 점수 임계 간격 |
| | `maxLevel` | 정수 또는 무제한 표기 | 난이도 상한 |
| `limits` | `maxEnemies`, `maxRegularProjectiles`, `maxSkillProjectiles` | 개 | §6.10 성능 예산 |
| `loop` | `FIXED_STEP_MS`, `MAX_FRAME_MS`, `MAX_SUBSTEPS`, `HUD_PUBLISH_INTERVAL_MS` | ms / 회 | §6.1, §6.2 |

### 6.7 그레이박스 렌더 규약 (★ 유지)

- **에셋 파일(png/jpg/svg/오디오) 추가 전면 금지.** 모든 표현은 `ctx.fillRect` / `ctx.arc` / `ctx.fillText` 로만 구성한다.
- 색상은 `src/render/palette.ts`의 단일 팔레트에서만 가져온다. 초기 값은 뼈대 코드를 계승한다.

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `background` | `#222222` | 캔버스 배경 |
| `player` | `#FFB6C1` | 에르핀 |
| `enemy` | `#90EE90` | 슬라임 |
| `regularProjectile` | `#FFD700` | 일반탄 |
| `skillProjectile` | `#00FFFF` | 스킬탄 |
| `hitFlash` | `#FF4D4D` | 피격 프레임 강조 |
| `debug` | `#00E5FF` | 히트박스 외곽선(디버그 토글 시) |

- **★ 스프라이트 교체 지점은 `src/render/drawEntity.ts` 단 한 곳으로 고정한다.**
  `drawEntity(ctx: CanvasRenderingContext2D, entity: Readonly<Entity>): void` 는 `entity.kind`를 키로 **렌더 디스크립터**
  `Readonly<Record<EntityKind, { shape: 'rect' | 'circle'; colorToken: PaletteToken }>>` 를 조회해 그린다.
  → `Record<EntityKind, ...>` 이므로 **엔티티 종류가 추가되면 이 테이블을 채우지 않는 한 컴파일되지 않는다**(누락 방지가 타입으로 강제됨).
  향후 에셋 도입 시 이 파일에서 디스크립터에 `image` 필드를 추가하고 `drawImage`로 분기하면 되며, **`src/game/**`과 `src/ui/**`은 단 한 줄도 수정되지 않아야 한다.** 이 조건이 깨지는 설계는 반려한다.
- 캔버스는 논리 해상도 800x600을 유지하되, HiDPI 대응은 `GameCanvas.tsx`에서 `devicePixelRatio` 기반 backing store 스케일링으로 처리하고 게임 로직은 항상 논리 좌표만 다룬다.
- 표시 크기는 CSS가 소유한다. `GameCanvas.tsx`는 `canvas.style.width/height`에 800x600 고정값을 쓰지 않으며, `.game-board`와 `.game-canvas`가 다음 반응형 규칙을 지킨다.
  - 문서 루트는 `100vw`와 동적 뷰포트 높이(`100dvh`, 미지원 환경은 `100vh`)를 사용하고 페이지 스크롤을 만들지 않는다.
  - 게임 보드는 뷰포트 내부에서 가능한 가장 큰 **4:3 contain 크기**를 사용하고 수평·수직 중앙 정렬한다. 남는 영역은 배경 레터박스로 둔다.
  - 캔버스, HUD, 게임오버 오버레이는 동일한 게임 보드 좌표계를 공유한다. HUD는 보드 내부 오버레이로 배치해 좁은 모바일 가로 높이에서도 보드 밖으로 밀려나지 않아야 한다.
  - 대표 검증 뷰포트는 데스크톱 1440x900, 태블릿 1024x768, 모바일 가로 844x390이다. 모든 뷰포트에서 보드 잘림, 문서 스크롤, HUD 오버플로가 없어야 한다.
- 디버그 오버레이(히트박스, FPS)는 render 계층에서 플래그로 on/off, 기본값 off.

### 6.8 테스트 규약

- **환경 분리(필수):** `vite.config.ts`의 Vitest 설정에서 기본 `environment: 'node'`, `tests/component/**`만 `jsdom`으로 전환한다(`test.projects` 또는 파일 상단 `// @vitest-environment jsdom`). → 순수 로직 테스트가 DOM 부팅 없이 빠르게 돈다.
- **Canvas 스텁(필수):** jsdom은 2D 컨텍스트를 구현하지 않아 `getContext('2d')`가 `null`을 반환해 컴포넌트가 크래시한다. `vitest.setup.ts`(FE-DEV 소유)에서 `HTMLCanvasElement.prototype.getContext`를 **모든 드로잉 메서드가 `vi.fn()`인 목 객체**를 반환하도록 스텁한다. 컴포넌트 테스트는 "무엇이 그려졌는가"를 검증하지 않는다.
- **rAF 제어:** `vi.useFakeTimers()` + rAF 스텁으로 루프를 수동 진행시킨다. 실시간 대기 금지.
- **타입 안전한 테스트:** 테스트 코드도 `tsconfig.json` include 대상이며 `npm run typecheck`에서 검사된다. 테스트에서 `any` 금지, 목 객체 단언은 `tests/helpers/`의 **타입 붙은 빌더**에 격리한다.
- **역할 분담**
  - `tests/unit/**` — `src/game/**` 순수 로직. **주력이며 커버리지 목표 80% 이상.**
  - `tests/component/**` — HUD 텍스트 렌더링, 키 입력 반영, 게임오버 오버레이 노출 등 **화면에 보이는 결과**만 검증.
  - `e2e/**` — 실제 브라우저에서 앱 부팅, HUD 초기값, 키 입력 후 점수/HP 변화, 게임오버 도달.
- **네트워크 모킹 계층 없음:** 서버 통신이 없으므로 MSW 등을 도입하지 않는다. 격리는 **시간·난수 주입**으로 달성한다.

### 6.9 E2E 관측 가능성 규약 (canvas 게임의 필수 장치)

1. **HUD `data-testid` 고정** — `hud-hp`, `hud-mana`, `hud-score`, `hud-level`, 캔버스 `game-canvas`, 게임오버 오버레이 `game-over`.
   HUD 표시 문자열도 계약(`ui-contracts.md`)으로 고정: `♥ {hp} / {maxHp}`, `MANA: {mana}%`, `SCORE: {score}`, `LV. {level}`.
   게임오버 오버레이(`game-over`)는 **재시작 키(`R`)를 텍스트로 안내**해야 한다(§9 D-6). E2E는 이 텍스트 노출 → `R` 키 입력 → HUD 초기값 복귀를 하나의 시나리오로 검증한다.
2. **테스트 브릿지 (`src/testBridge.ts`)**
   - **타입 선언 위치:** 인터페이스 `TestBridge`는 `src/contracts/ui.ts`(tech-leader), **전역 확장은 `src/types/global.d.ts`(frontend-developer)** 에 둔다.
     ```ts
     // src/types/global.d.ts
     import type { TestBridge } from '@/contracts';
     declare global { interface Window { __TRICKAL_TEST__?: TestBridge } }
     export {};
     ```
     `declare global`은 **컴파일 산출물이 없으므로 번들 크기 영향 0**이다. `?e2e=1`이 아닐 때 `undefined`인 현실을 타입에 반영하기 위해 **옵셔널(`?`)로 선언**한다(사용처에서 널 검사 강제).
   - **API는 3개만:** `getSnapshot(): Readonly<HudSnapshot>`, `stepFrames(n: number): void`, `seed(n: number): void`.
     `stepFrames(n)`은 rAF를 우회해 시뮬레이션을 n틱 강제 진행 → E2E가 실시간 대기 없이 결정적으로 검증 가능.
     **검증 전용 읽기/진행 API이며, 게임 규칙을 우회하는 치트 API(점수 임의 설정 등)는 제공하지 않는다.**
   - **프로덕션 번들 취급:** E2E는 `npm run preview`(프로덕션 빌드)에서 돌아야 하므로 브릿지를 빌드에서 제거할 수 없다. 대신
     ① 활성화 조건을 **URL 쿼리 `?e2e=1`** 로 런타임 게이팅하고,
     ② `GameBoard.tsx`에서 **동적 `import('@/testBridge')`** 로 로드해 **별도 청크로 분리**한다 → 일반 사용자 경로에서는 네트워크 요청조차 발생하지 않는다.
     ③ 브릿지 모듈은 **읽기 + 틱 진행만** 수행하므로 노출되어도 서버·데이터 리스크가 없다(클라이언트 단독 게임, 영속 데이터 없음).
3. `e2e-tester`는 실패 시 Playwright trace + 스크린샷을 증거로 남긴다(`trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`).

### 6.10 관측성·보안 제약 (이번 단계 최소 요건)

| 항목 | 규약 |
| --- | --- |
| 로깅 | 프로덕션 빌드에 `console.log` 잔존 금지(ESLint `no-console`, `warn`/`error`만 허용). 디버그 출력은 `import.meta.env.DEV` 가드 필수. |
| 에러 격리 | `App.tsx` 하위에 React Error Boundary 1개(`ErrorFallback.tsx`). 루프 콜백 내부 예외는 잡아 루프를 정지하고 세션을 `error` 상태로 전이한다(무한 예외 폭주 방지). |
| 성능 예산 | 1프레임 `stepWorld + drawScene` 합계 **5ms 이내**. 엔티티 상한을 `balance.ts`에 두고 초과 스폰을 차단한다. |
| 보안 | `innerHTML` / `eval` / `dangerouslySetInnerHTML` 금지. 외부 네트워크 요청 없음. 비밀값 없음. 서드파티 스크립트 추가 금지. |
| 접근성 | `<canvas>`에 `aria-label` 부여, HUD는 실제 텍스트 노드로 렌더. 키보드만으로 전체 플레이 가능. |
| 배포 | **이번 단계 범위 밖.** CI/CD·컨테이너·호스팅 설정을 만들지 않는다. |

---

## 7. 부트스트랩 순서 (Scaffolding Protocol) — **필독**

### 7.1 실측 제약
> `npm create vite@latest . -- --template react-ts` 는 이 저장소가 비어 있지 않아(`README.md`, `.claude/` 존재) **대화형 확인 프롬프트에서 자동 취소된다.**
> 따라서 **스캐폴딩은 반드시 수동으로** 수행한다. 임시 디렉터리에 생성 후 복사하는 방식도 금지한다(경로·lockfile 오염 위험).
> 또한 Phase 2에서 `tech-leader`가 이미 `src/contracts/**`를 생성해 두었을 수 있다. **frontend-developer는 이 디렉터리를 덮어쓰거나 삭제하지 않는다.**

### 7.2 순서

| # | 시점 | 주체 | 작업 |
| --- | --- | --- | --- |
| 0 | Phase 2 | `tech-leader` | `src/contracts/**` 타입 소스 + `03_contracts/{invariants,ui-contracts,module-map}.md` 작성 → §4.2 Phase 2 명령으로 독립 검증. |
| 1 | Phase 3 착수 **직후 최우선** | `frontend-developer` | **수동 스캐폴딩 — 아래 파일을 직접 작성한다.**<br>`package.json`(§2.1 의존성 + §4.1 스크립트 15종 + `"type": "module"`), `index.html`, `vite.config.ts`(Vite+Vitest 통합·`@/*` alias·포트 5173/4173 고정·테스트 환경 분리), `vitest.setup.ts`(jest-dom + canvas 스텁), **`tsconfig.json`**(§2.2, include: `src`/`tests`/`e2e`), **`tsconfig.node.json`**(§2.2, include: `*.config.ts`), `eslint.config.ts`(§4.3), `.prettierrc`, **`.gitignore`**(저장소에 없으므로 신규 생성: `node_modules/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `.vite/`, `*.local`), `src/vite-env.d.ts`, `src/types/global.d.ts`(§6.9). |
| 2 | 1 직후 | `frontend-developer` | `npm install` → `package-lock.json` 생성 확인. |
| 3 | 2 직후 | `frontend-developer` | **골격 파일 배치.** `src/main.tsx`, `src/App.tsx`, `src/game/balance.ts`(계약 `BalanceConfig` 기반 실제 수치 — **§6.6.1 필수 키 목록을 빠짐없이 채운다.** §9가 확정 사양이므로 `// TODO(balance)` 유보 표기는 사용하지 않는다), 나머지 모듈은 **파일과 export 시그니처만 생성하고 본문은 최소 스텁**(QA가 import할 대상이 존재해야 함). 스텁도 §5.4 패턴(`export const f: ContractType = ...`)을 지키며 `any` / `as unknown as` 로 때우지 않는다. |
| 4 | 3 직후 | `frontend-developer` | **게이트 4종 확인:** `npm run lint` → `npm run typecheck` → `npm test`(0 test 통과) → `npm run build`. **4개 전부 통과하기 전에는 다음 단계로 넘어가지 않는다.** |
| 5 | 4 통과 후 | `frontend-developer` | `SendMessage(to: "frontend-qa", ...)` — "스캐폴딩 완료. TypeScript 스택·명령어·계약(`@/contracts`)·모듈 경로 준비됨. Red 테스트 작성을 시작하세요." (실행한 4개 명령과 결과 첨부) |
| 6 | 5 수신 후 | `frontend-qa` | `src/contracts/**` + `module-map.md` + `invariants.md` + `ui-contracts.md` 만 보고 **실패하는 테스트**를 `tests/unit/**`(`.test.ts`) / `tests/component/**`(`.test.tsx`)에 작성. `npm test`로 **타입/문법 오류가 아닌 어설션 실패(Red)** 임을 확인. |
| 7 | 6 완료 후 | `frontend-qa` → `frontend-developer` | SendMessage로 구현 착수 통지. |
| 8 | 7 수신 후 | `frontend-developer` | 스텁을 실제 구현으로 채워 Green 달성 → 게이트 4종 재확인 → `code-reviewer`에 리뷰 요청. |
| 9 | 리뷰 승인 후 | `e2e-tester` | `playwright.config.ts` 작성(`webServer`로 `npm run preview` 자동 기동, baseURL `http://localhost:4173`, trace/screenshot 설정), `npx playwright install chromium`, `e2e/**` 시나리오 작성 및 실행. |

### 7.3 커밋 규약
- 스캐폴딩은 **단일 커밋**: `chore: bootstrap vite + react + typescript greybox scaffolding`
- `package-lock.json`은 커밋한다. `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`는 커밋하지 않는다.
- **원격 push 및 브랜치 조작은 `release-manager` 또는 오케스트레이터 지시가 있을 때만 수행한다.**

---

## 8. 뼈대 코드로부터의 변경 사항 (사용자 원본 대비)

| 원본 | 변경 | 사유 |
| --- | --- | --- |
| **JavaScript + `.jsx`** | **TypeScript strict + `.tsx` 전면 전환** | 사용자 확정 지시. 계약의 컴파일러 강제, 엔티티 판별 유니온, 리팩터링 안전성 확보(§2) |
| 엔티티를 익명 객체 리터럴로 선언 | `src/contracts/entities.ts`의 **판별 유니온 타입**으로 모델링 | 종류 추가 시 렌더/충돌/전투 갱신 누락을 컴파일 에러로 검출(§6.3) |
| `useEffect` 내부에 엔티티 배열 리터럴 | `game/createWorld.ts` 팩토리로 분리 | 리마운트 시 재현성 + 단위 테스트 가능 |
| 엔티티가 `color` 필드 보유 | `color` 제거, `kind` → 팔레트 조회 | 로직/표현 분리 → 스프라이트 교체 시 로직 무수정(§6.7) |
| `render()` 안에서 위치 갱신 예정(TODO) | `stepWorld`(로직) / `drawScene`(출력) 완전 분리 | 캔버스 없이 로직 테스트 가능 — **이번 설계의 핵심 목표** |
| `hp/mana/score/level`을 `useState`로 보유 | `world.session` 보유 + `hudStore` 스로틀 발행 | 매 프레임 리렌더 방지(§6.1) |
| 인라인 `style` 객체 | `index.css` + 클래스 + `data-testid` | E2E/컴포넌트 테스트의 안정적 셀렉터 확보(§6.9) |
| dt 개념 없음 | 고정 스텝 + 누산기 | 프레임률 독립성 및 테스트 재현성(§6.2) |
| `canvasRef.current` / `getContext` 널 미처리 | strict 하에서 **널 가드 필수**(`!` 단언 금지) | 런타임 크래시 차단(§6.5.3) |
| 매직 넘버 인라인(50, 300, 40, 800, 600 …) | `balance.ts` 단일 집약 + `as const satisfies` | 튜닝 지점 일원화(§6.6) |
| **플레이어 이동: 미구현**(좌표 고정, 입력 처리 없음) | **8방향 자유 이동 + 대각선 속도 정규화 + x·y 양축 경계 클램프** | §9 D-1 확정. 이동·스킬·재시작 의미 입력 6종(`event.code`), `INV-MOVE-1/2` 불변식 신설(§6.2.1) |
| 단일 투사체 배열과 수동 갱신 | 일반탄·스킬탄 타입/배열/이동/충돌/렌더 분리, 0.3초 일반 자동 발사와 MANA 유도 스킬 | §9 D-2/D-3 확정. 탄종별 에셋·이펙트 확장 시 로직 분기 확산 방지 |
| 재시작 수단 없음 | 게임오버 오버레이 + `R` 키 → `createWorld()` 재호출 + `hudStore.reset()` | §9 D-6 확정(§6.2.1-(6), §6.9) |

---

## 9. 확정된 게임 디자인 결정 (Confirmed Game Design Decisions)

> 아래 7개 항목은 **사용자가 확정한 사양**이다. 가정이나 기본값이 아니며, **협의 없이 변경할 수 없다.**
> `tech-leader`는 이 사양을 `src/contracts/**` 타입과 `.claude/_workspace/03_contracts/invariants.md`·`ui-contracts.md`에 고정하고, `frontend-developer`는 **§6.6.1의 필수 키 목록**에 따라 `src/game/balance.ts`에 수치를 확정 배치한다. **`// TODO(balance)` 유보 표기는 더 이상 사용하지 않는다.**

| # | 항목 | 확정 사양 | 상세 규약 |
| --- | --- | --- | --- |
| **D-1** | 플레이어 이동 | **8방향 자유 이동.** 캔버스 전역(800x600)을 이동하며 **x·y 모두 화면 경계로 클램프**된다. 대각선 동시 입력 시 **속도 정규화** 필수. | §6.2.1 |
| **D-2** | 발사 방식 | **일반탄과 스킬탄 완전 분리.** 일반탄은 0.3초 자동 발사, Space 스킬 중에는 중지한다. 스킬탄은 0.15초마다 RNG 기반 Y축 초기 확산을 받고 최초 목표를 락온한다. 목표가 사라질 때만 최근접 적을 재획득하며, 중심 거리 150px 미만에서 회전력을 높여 공전을 방지한다. 스킬 종료 후 일반탄을 재개한다. | §6.2.1 |
| **D-3** | MANA | **0~100 포화 자원.** 일반 상태에서 초당 0.5 회복하고 일반탄 처치로 5를 얻으며, 스킬 중 초당 30 소모한다. 20 이상에서 스킬을 시작하고 스킬탄 처치는 MANA를 지급하지 않는다. | §6.2.1, §6.9 |
| **D-4** | 레벨업 | **점수 임계값 기반.** 레벨 상승 시 **스폰 주기가 단축**된다(이번 단계 난이도 상승의 유일한 축). | §6.2.1 |
| **D-5** | 적 행동 | **좌측 방향 직진**(x 감소). 화면 **좌측 경계를 이탈하면 HP 변화 없이 해당 적만 제거**. 플레이어 HP는 직접 접촉 시에만 감소한다. | §6.2.1 |
| **D-6** | 재시작 | **게임오버 오버레이 표시 + `R` 키로 재시작** (`createWorld()` 재호출로 월드 전체 재생성, `hudStore.reset()` 동반). | §6.2.1, §6.9 |
| **D-7** | 히트박스 디버그 | **토글 키 미제공.** 렌더 계층 **내부 플래그(기본 off)** 로만 존재하며 사용자 입력에 노출하지 않는다. | §6.7 |

**아직 열려 있는 항목: 없음.** 새로운 게임 디자인 질문이 생기면 구현자가 임의 판단하지 말고 오케스트레이터에게 질의한다.

---

## 10. 설계 자체 검증 체크리스트

- [x] 언어가 **TypeScript 단일**로 확정되고, 이 프로젝트 특유의 이득(판별 유니온·계약 강제·리팩터링 안전성)으로 근거가 서술되었는가 → §2
- [x] `typescript` / `@types/react` / `@types/react-dom` / `@types/node` / `typescript-eslint`가 의존성 목록에 있는가 → §2.1
- [x] tsconfig 정책이 옵션별 판단 근거와 함께 확정되었는가(특히 `noUncheckedIndexedAccess` **false** + 대체 방어책) → §2.2.2
- [x] Vite/Vitest/Playwright/ESLint/에디터가 각각 어떤 tsconfig를 참조하는지, 단일/분리 여부가 확정되었는가 → §2.2.1 (분리 2개, project references 미사용)
- [x] 경로 트리의 모든 확장자가 `.ts` / `.tsx`이고, 타입 파일 위치가 확정되었는가 → §3.1 (`src/contracts/**`, `src/types/global.d.ts`)
- [x] 계약 형식이 **(a) tech-leader가 타입 소스 직접 소유**로 결정되고 소유권 충돌이 해소되었는가 → §5.1, §3.2
- [x] `module-map.md`의 존치 여부를 판단하고 중복을 제거했는가 → §5.5 (존치, 5개 컬럼으로 슬림화)
- [x] `typecheck`가 `tsc --noEmit` 기반이고, Phase 2 계약 검증 명령이 재검토되었는가 → §4, §4.2
- [x] JSDoc 타입 규약이 전부 제거되고 TS 규약(판별 유니온·readonly/as const·any 금지·as 허용 범위)으로 대체되었는가 → §6.3, §6.5
- [x] `window.__TRICKAL_TEST__` 전역 선언 위치와 프로덕션 번들 취급이 결정되었는가 → §6.9
- [x] 스캐폴딩 파일 목록에 `tsconfig*.json`과 `.gitignore`가 포함되고 게이트 4종이 유지되었는가 → §7.2
- [x] §8이 "JS → TS 전환"을 포함해 갱신되었는가 → §8
- [x] 유지 지시 항목(§6.1 HUD 동기화, §6.2 고정 타임스텝, §6.7 그레이박스 렌더)이 보존되었는가 → 전부 유지
- [x] **§9가 「미결 사항」에서 「확정된 게임 디자인 결정」(D-1~D-7)으로 갱신되고 조건부 서술이 전부 제거되었는가** → §9
- [x] **D-1(8방향 이동) 파급이 문서 전체에 반영되었는가** → §6.2.1 신설(이동·스킬·재시작 의미 입력 6종·대각선 정규화·양축 클램프·스폰/이탈/무적·재시작), §6.4 실행 순서, §6.6.1 balance 키, §5.2 계약 산출물, §6.9 오버레이, §8, §9
- [x] `tech-leader`가 추측 없이 `BalanceConfig`를 정의할 수 있도록 키·단위 목록이 제공되었는가 → §6.6.1
- [x] 배포/인프라를 설계하지 않고 범위 밖으로만 선언했는가 → §1.2, §6.10
