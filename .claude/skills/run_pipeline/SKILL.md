---
name: run_pipeline
description: 소프트웨어 개발 파이프라인(SDLC)을 지휘합니다. 브랜치 파생부터 마이크로 커밋, E2E 통합 테스트, MR 생성까지 애자일 사이클 전체를 통제합니다. 전체 시스템 개발, 하네스 가동, 특정 파트(프론트엔드 단독, 백엔드 단독, 인프라 단독 등) 작업 요청 시 반드시 이 스킬을 호출하십시오. 단, 코드의 단순 에러 디버깅 등 국소적인 작업에는 이 스킬을 트리거하지 마십시오.
allowed-tools:
  - TaskCreate
  - TaskUpdate
  - Agent
  - SendMessage
  - Read
  - Write
  - Bash
---

# Skill: Master Orchestrator Pipeline

이 스킬은 12개의 에이전트 페르소나를 페이즈(Phase)별로 동적 라우팅하여 스폰하고, 공유 작업 목록(Task)과 직접 통신(P2P)을 통해 작업을 조율한 뒤 안전하게 해체하는 마스터 지휘소다.

## 📌 Orchestration Rules (절대 준수 규칙)

1. **팀원 간 직접 통신 (P2P Communication)**
   - `Agent`로 teammate를 이름과 역할을 지정해 스폰한다. 첫 teammate가 스폰되면 현재 세션의 agent team이 자동 구성된다.
   - 단일 인스턴스 역할의 teammate 이름은 반드시 agent type과 동일하게 지정한다(예: `frontend-developer`). 같은 역할을 복제할 때는 `frontend-developer-1`처럼 고유 이름을 부여하고, spawn prompt에 함께 통신할 모든 실제 recipient 이름을 명시한다.
   - teammate들은 리더(오케스트레이터)를 거치지 않고, 반드시 `SendMessage(to: "정확한 에이전트명")`를 사용하여 서로 직접 소통하고 피드백 루프를 돌아야 한다.
   - 브로드캐스트 수신자 `"all"`은 사용하지 않는다. 모두에게 알려야 할 때는 활성 teammate별로 한 번씩 전송한다.
2. **명시적 작업 할당 (Task Board)**
   - 각 페이즈가 시작될 때 오케스트레이터는 구두로 지시하지 말고, 반드시 `TaskCreate`를 호출하여 에이전트들이 수행할 작업(Task)들을 명확한 티켓 형태로 보드에 등록해야 한다.
3. **마이크로 커밋 및 안전 종료 시퀀스 (Micro-commits & Graceful Shutdown)**
   - 각 Phase나 개발 트랙 종료 시 활성 teammate 각각에게 이름으로 `shutdown_request`를 전송하고, 파일 I/O 완료와 종료 승인을 모두 확인한다.
   - **그 직후, 오케스트레이터가 직접 `Bash` 도구를 사용하여 해당 Phase의 변경만 스테이징하고 `git commit -m "feat(Phase N): [작업명] 완료"` 형식으로 스냅샷을 저장한다.**
   - 별도 팀 삭제 도구는 사용하지 않는다. 공유 팀 리소스는 세션 종료 시 자동 정리된다.
4. **감사 로그 기록 (Audit Logging)**
   - 각 페이즈가 시작하고 종료될 때마다 `.claude/_workspace/log/orchestrator-log.jsonl` 파일에 Append-only 방식으로 로그를 남긴다.
   - 포맷: `{"timestamp": "ISO8601", "phase": "Phase N", "status": "START|END", "task_batch": ["task1", "task2"]}`
5. **기술 스택 SSOT 강제 (Stack Binding)**
   - 이 하네스는 **어떤 기술 스택도 전제하지 않는다.** 스택·경로 소유권·표준 명령어·계약 형식·아키텍처 규약은 오직 `.claude/_workspace/01_architecture/design.md`가 정의하며, 모든 하위 에이전트는 이를 읽고 따른다.
   - 스폰 프롬프트에는 항상 **"작업 착수 전 `design.md`의 기술 스택·소유권·표준 명령어·규약 섹션을 먼저 읽을 것"**을 명시한다.
   - 하위 에이전트가 `design.md`에 없는 프레임워크·도구·명령어를 사용하려 하면 즉시 중단시키고 아키텍처를 갱신하거나 사용자에게 질의한다.

---

## 🚀 Workflow (작업 순서)

### Phase 0: 컨텍스트 분석 및 동적 라우팅
- 사용자 요청과 `.claude/_workspace/`의 기존 산출물을 분석하여 필요한 페이즈만 선택한다.
- ⭐️ **스택 확보 선행 검사:** `design.md`에 「기술 스택」·「디렉터리 구조 및 소유권」·「표준 명령어」 섹션이 존재하는지 확인한다.
  - **없거나 불완전한 경우:** 어떤 라우트든 구현 페이즈로 진입하기 전에 스택을 먼저 확정한다. 기존 코드베이스가 있으면 `system-architect`를 **스택 확정 목적으로 최소 범위 호출**하여 현행 스택(매니페스트·설정·디렉터리 구조 기반)을 `design.md`에 기록시킨다. 신규 프로젝트면 Phase 1을 정식 수행한다.
  - **추론조차 불가한 경우:** 파이프라인을 멈추고 사용자에게 스택 결정을 질의한다. 스택을 추측해 구현에 들어가지 않는다.
  - **전체 구축 (Full):** Phase 1 ➔ 2 ➔ 3(Track A+B) ➔ 4 ➔ 5
  - **프론트엔드 단독 (FE-only):** Phase 2(계약 필요 시) ➔ Phase 3(Frontend QA/Developer/Reviewer) ➔ 4 ➔ 5
  - **백엔드 단독 (BE-only):** Phase 2(계약 필요 시) ➔ Phase 3(Backend QA/Developer/Reviewer) ➔ 4 ➔ 5
  - **인프라 단독 (Infra-only):** Phase 3 Track B만 실행
  - **문서 단독 (Docs-only):** Phase 5의 `tech-writer`만 실행
- `orchestrator-log.jsonl`에 `INIT` 로그와 선택·생략한 페이즈 및 근거를 기록한다.

### Phase 1: 아키텍처 설계
- 전체 구축이거나 아키텍처 변경이 필요한 경우에만 `system-architect` agent type으로 teammate들을 이름을 지정해 스폰하고, `design.md`를 산출한다.
- ⭐️ **산출물 검수:** `design.md`에 **기술 스택(선정 근거 포함)·역할별 쓰기 소유권·표준 명령어·계약 산출 형식·아키텍처 규약**이 모두 채워졌는지 오케스트레이터가 직접 확인한다. 하나라도 비면 다음 페이즈로 진행하지 않고 아키텍트에게 보완을 지시한다.
- ⭐️ **[마이크로 커밋]** 완료 후 `git commit -m "docs(architecture): 시스템 설계 완료"` 실행.

### Phase 2: 티켓팅 및 브랜치 파생 (Sub-agent)
- 필요한 역할만 `Agent`로 호출한다. 신규 티켓이 필요하면 `issue-pm` agent type, 계약이 필요하면 `tech-leader` agent type을 명시한다.
- ⭐️ `issue-pm`이 티켓을 생성하고 **`<타입>/<이슈번호>-<슬러그>` 브랜치로 자동 전환(`git switch -c`)**하는지 모니터링한다. 타입은 `feature`·`fix`·`chore`·`docs` 중 작업 성격에 맞는 것을 사용한다.
- ⭐️ 오케스트레이터는 `issue-pm`이 생성한 이슈 본문의 범위가 사용자 요청과 일치하는지 **직접 대조 검증**한다. 불일치 시 즉시 `gh issue edit`/`glab issue update`로 정정하고 감사 로그에 편차를 기록한다.
- ⭐️ `issue-pm`의 `tools`에는 TaskBoard·`SendMessage`가 없다(서브 에이전트). 따라서 티켓 내용은 **스폰 프롬프트 본문에 전문을 담아** 전달하고, `TaskCreate`로 등록한 티켓 참조만 남기지 않는다.
- 완료 후 `git commit -m "chore(issue): 티켓 생성 및 인터페이스 계약 완료"` 실행.

### Phase 3: 병렬 개발 트랙 (FE/BE/QA/Infra)
- Track A (앱 구현): 선택된 라우트에 맞춰 `backend-qa`, `backend-developer`, `frontend-qa`, `frontend-developer`, `code-reviewer` agent type 중 필요한 역할을 정확히 명시해 스폰하고 P2P 핑퐁 개발을 진행한다.
- ⭐️ 스폰 프롬프트에 `design.md`의 스택·소유권·표준 명령어를 **먼저 읽으라는 지시**를 포함하고, 각 역할이 자기 소유 경로 밖을 건드리지 않도록 경계를 재확인시킨다.
- Track B (인프라): `devops-engineer` agent type으로 teammate를 스폰해 설정을 진행한다.
- 완료 후 `git commit -m "feat(app): Phase 3 애플리케이션 및 인프라 구현 완료"` 실행.
- 필요에 따라 `feat`을 제외한 `fix` 등의 커밋 메시지 형태도 허용된다.

### Phase 4: E2E 통합 테스트 (신규)
- `Agent`로 `e2e-tester` agent type을 명시해 호출한다.
- `design.md`가 확정한 E2E 도구로 작성된 테스트가 100% 통과(Green)되는지 대기한다.
- 완료 후 `git commit -m "test(e2e): 브라우저 통합 시나리오 검증 완료"` 실행.

### Phase 5: 릴리즈(MR) 및 문서화
- 라우팅 결과에 따라 `release-manager`와 `tech-writer` agent type 중 필요한 역할만 명시해 호출한다.
- 생성된 마이크로 커밋들을 모아 원격 저장소에 Push하고 MR/PR을 생성한 뒤 파이프라인을 종료한다.

---

## ⚠️ 에러 핸들링 (Error Handling)
- 각 트랙 내의 코드 리뷰 핑퐁 횟수나 스크립트 실행 재시도가 **3회를 초과**하여 `[PASS WITH WARNING]` 플래그가 반환되면, 오케스트레이터는 즉시 해당 파이프라인의 진행을 일시 정지(Pause)한다.
- `orchestrator-log.jsonl`에 에러 로그를 기록한 뒤 사용자에게 알림을 띄우고 인간 개입(Human Intervention)을 요청한다.
