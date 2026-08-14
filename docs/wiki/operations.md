# 로컬 실행과 운영 가이드

## 사전 요구사항

- Node.js 20.19 이상 또는 22.12 이상. 검증 환경은 Node.js 24.16.0이다.
- npm. 검증 환경은 npm 11.13.0이다.
- E2E 실행 시 Playwright Chromium.

## 설치와 개발 서버

```bash
npm install
npm run dev
```

개발 서버는 `http://localhost:5173`에 고정된다. 포트가 사용 중이면 다른 포트로 자동 변경하지 않고 실패한다.

## 프로덕션 빌드와 미리보기

```bash
npm run build
npm run preview
```

`build`는 TypeScript 검사를 선행하고 결과를 `dist/`에 만든다. 미리보기 서버는 `http://localhost:4173`에 고정된다.

## 품질 게이트

PR 전 다음 명령을 모두 통과시킨다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

세부 테스트 명령:

| 명령                     | 범위                             |
| ------------------------ | -------------------------------- |
| `npm run test:unit`      | DOM 없는 `tests/unit/**`         |
| `npm run test:component` | jsdom 기반 `tests/component/**`  |
| `npm run test:coverage`  | V8 커버리지와 `coverage/` 보고서 |
| `npm run test:watch`     | 로컬 감시 모드                   |

순수 게임 로직의 커버리지 목표는 80% 이상이다.

## E2E

최초 한 번 브라우저를 설치한다.

```bash
npx playwright install chromium
```

그다음 프로덕션 번들과 브라우저 시나리오를 실행한다.

```bash
npm run build
npm run e2e
```

Playwright가 `npm run preview`를 자동 기동하고 Chromium에서 `e2e/**`를 실행한다. 첫 재시도에는 trace, 실패에는 스크린샷을 `test-results/`에 남기며 HTML 보고서는 `playwright-report/`에 생성된다.

보고서 열기:

```bash
npm run e2e:report
```

## 테스트 환경 분리

- Vitest는 `tests/**/*.test.{ts,tsx}`만 수집한다. Playwright 스펙은 별도 러너가 담당한다.
- 기본 Vitest 환경은 Node다.
- 컴포넌트 테스트는 파일 상단의 `// @vitest-environment jsdom`으로 jsdom을 선택한다.
- jsdom에는 Canvas 2D가 없으므로 `vitest.setup.ts`가 최소 context 스텁을 제공한다. 픽셀 결과는 단위 테스트 대상이 아니다.

## 자주 발생하는 문제

### `Port 5173/4173 is already in use`

`strictPort` 정책 때문에 다른 포트를 자동 선택하지 않는다. 해당 포트를 사용하는 기존 Vite 프로세스를 정상 종료하고 다시 실행한다.

### Playwright 실행 파일을 찾을 수 없음

`npx playwright install chromium`을 실행한다. 브라우저는 프로젝트가 아니라 사용자 Playwright 캐시에 저장된다.

### Windows 샌드박스에서 E2E가 테스트 후 종료되지 않음

테스트가 모두 통과했는데 preview 자식 프로세스 정리 단계에서 멈춘다면 권한이 제한된 셸인지 확인한다. 일반 PowerShell에서 `npm run e2e`를 실행하면 Playwright가 프로세스 트리를 정상 정리할 수 있다.

### jsdom의 `HTMLCanvasElement.getContext` 오류

컴포넌트 테스트가 `vitest.setup.ts`를 사용하고 있는지 확인한다. 새 Canvas API를 렌더 계층에 추가했다면 스텁에도 해당 메서드를 추가한다.

### 경로 별칭이 개발 환경과 테스트에서 다르게 동작함

`tsconfig.json`의 `@/*`와 `vite.config.ts`의 `@` alias가 모두 `src/`를 가리키는지 확인한다.

### ESLint가 설정 파일의 TypeScript 프로젝트를 찾지 못함

루트 `*.config.ts`는 `tsconfig.node.json`을 사용한다. `eslint.config.ts`의 공통 `projectService.defaultProject`를 파일별로 다르게 재정의하지 않는다. parser service는 한 ESLint 프로세스에서 공유되므로 설정 순서에 의존할 수 있다.

## 생성물과 Git

다음 경로는 커밋하지 않는다.

- `node_modules/`
- `dist/`
- `coverage/`
- `playwright-report/`
- `test-results/`
- `.vite/`

`package-lock.json`은 재현 가능한 설치를 위해 커밋한다.
