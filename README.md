# Trickal Shooting

React와 Canvas 2D로 만든 트릭컬 슈팅게임 그레이박스입니다. 이미지·사운드 없이 도형만으로 이동, 발사, 적 스폰, 충돌, 점수·레벨 진행, 게임오버와 재시작까지의 플레이 루프를 검증합니다. 논리 해상도 800×600은 유지하면서 게임 화면은 브라우저 뷰포트에 맞춰 4:3으로 반응형 표시됩니다.

적이 화면 왼쪽 경계를 넘어 사라져도 생명은 감소하지 않습니다. 플레이어 생명은 적과 직접 접촉했을 때만 감소합니다.

## 화면 지원

- 데스크톱과 태블릿에서는 게임 보드가 뷰포트 안의 최대 4:3 크기로 중앙 배치됩니다.
- 모바일은 가로모드 레이아웃을 지원하며 HUD와 게임오버 화면도 보드 내부에서 함께 축소됩니다.
- 현재 모바일 지원은 표시 레이아웃에 한정됩니다. 터치 조작은 아직 제공하지 않으므로 플레이에는 키보드가 필요합니다.

## 조작법

| 동작               | 키                 |
| ------------------ | ------------------ |
| 이동               | `WASD` 또는 방향키 |
| 발사               | `Space`            |
| 게임오버 후 재시작 | `R`                |

## 빠른 시작

```bash
npm install
npm run dev
```

개발 서버는 `http://localhost:5173`에서 실행됩니다.

## 검증 명령

| 목적                 | 명령                    |
| -------------------- | ----------------------- |
| 린트                 | `npm run lint`          |
| 타입 검사            | `npm run typecheck`     |
| 단위·컴포넌트 테스트 | `npm test`              |
| 커버리지             | `npm run test:coverage` |
| 프로덕션 빌드        | `npm run build`         |
| Chromium E2E         | `npm run e2e`           |
| 포맷 검사            | `npm run format:check`  |

E2E를 처음 실행하는 환경에서는 `npx playwright install chromium`이 필요합니다. 프로덕션 빌드 결과를 검사하므로 `npm run build` 후 실행하세요.

## 구조

- `src/contracts/`: 런타임 코드가 없는 TypeScript 계약
- `src/game/`: DOM과 분리된 결정적 게임 시뮬레이션
- `src/hooks/`: 키보드·고정 타임스텝 루프·HUD 연결
- `src/render/`: Canvas 그레이박스 렌더링
- `src/ui/`: React HUD와 화면 구성
- `tests/`: Vitest 단위·컴포넌트 테스트
- `e2e/`: Playwright 브라우저 시나리오

## 문서

- [아키텍처와 주요 결정](docs/wiki/architecture.md)
- [내부 API와 계약](docs/wiki/api_spec.md)
- [로컬 실행·검증·문제 해결](docs/wiki/operations.md)

현재 범위에는 백엔드, 영속 저장, 배포 인프라, 실제 에셋, 모바일 터치 조작과 MANA 스킬 발동이 포함되지 않습니다.
