# IGFL 홈페이지

ISE & GSDS Futsal League. KAIST 이메일 로그인, 선수 등록, 팀 운영, 자율 경기·심판 배정, 결과 확인과 Elo 파워랭킹을 제공한다. 흰 배경과 짙은 초록색 포인트의 승인 디자인을 따른다.

2026-10-18 기준 선수·팀·경기·심판·운영진 화면과 서버 규칙을 구현했다. 자동 테스트 **72개 통과**. 합성 데이터 브라우저에서 양 팀 기록 제출 → 양 팀 확인 → 내부 심판 최종 승인 → 랭킹 갱신을 확인했다. 실제 Apps Script 서버의 공개 리그 조회도 로컬 브라우저에서 연결했다. 정확한 `@kaist.ac.kr` 이메일 인증을 허용했으며 실제 선수 가입과 시즌은 계속 닫혀 있다. 실제 이메일 로그인 검증은 [인증 배포 기록](docs/AUTH_DEPLOYMENT.md)에 있다.

**공개 홈페이지:** [IGFL](https://noeyusiohc.github.io/igfl/). 2026-10-16 사용자 승인으로 [저장소](https://github.com/noeyusiohc/igfl)를 공개하고 PR #1을 main에 병합했다. [Pages 배포 실행](https://github.com/noeyusiohc/igfl/actions/runs/38854152477)의 테스트·빌드·배포가 모두 성공했다. 실제 Pages 브라우저에서 소개·랭킹 데이터·인증 서버 health 응답을 확인했다. 기존 개인 홈페이지와 별도 프로젝트 경로를 사용한다.

**리그 운영 개통 전 상태다.** 개인정보·경기 운영 정책을 반영했으며 사용자 지시로 실제 선수 가입은 서버에서 닫혀 있다. 시즌도 닫혀 있고 최초 운영진·알림 수신자·메일 작업은 아직 설정하지 않았다. 공개 홈페이지에는 실제 선수·팀 데이터나 합성 검증 계정 선택기를 넣지 않는다.

현재 추가 기능: 생년월일 제거·별도 필수 이름/연구실 공개 동의·회원 탈퇴, 팀 대표 전용 경기 제안과 홈페이지 알림, 일정 변경·취소 합의, 자책골·예외 보고·확정 후 정정이다. 심판 1명·흐르는 시계를 사용한다.

리그 데이터는 비공개 Sheets를 유지하고 인증 기록은 Script Properties로 분리한다. 탈퇴·리그 보관 기간 정리 시 새 빈 시트를 생성·검증·전환하며 이전 파일은 운영자가 수동 삭제한다. 도구 실행과 실패 대응은 [저장소 운영 안내](docs/STORAGE_RUNBOOK.md), 실제 Google 시험은 [삭제·자동 정리 검증](docs/PRIVACY_VERIFICATION.md)을 따른다. 실제 가입은 계속 닫혀 있다.

## 로컬 실행

Node.js 22 이상. 외부 패키지 설치는 필요 없다.

```sh
node --test
node scripts/build.mjs
node scripts/dev.mjs
```

- `http://127.0.0.1:4173/`: 실제 Apps Script 인증·리그 서버를 사용하는 홈페이지. 현재는 빈 리그와 닫힌 가입 상태다.
- `http://127.0.0.1:4173/preview/`: 합성 데이터와 검증 계정 선택기가 있는 별도 개발 화면. 실제 메일을 보내지 않는다. 선수·주장·심판·운영진 역할을 전환해 볼 수 있다.

개발 화면은 `.local/league-dev.json`에 합성 데이터를 저장한다. 재시작하면 검증 계정을 다시 선택한다. 초기 샘플로 돌아가려면 서버 종료 후 해당 파일을 다른 이름으로 이동하고 다시 실행한다. 실제 개인정보를 넣지 않는다. 개발 API는 localhost에만 바인딩하며 **외부에 배포하지 않는다.**

`dist/`에는 공개 프런트엔드만 들어간다. `server/`, `dev/`, 테스트, Apps Script, `.local/`은 복사되지 않는다. 공개 코드에는 비밀키와 선수 정보를 두지 않는다.

## 서버와 배포

```sh
node scripts/build-gas.mjs
```

`.local/AppsScript.gs`를 생성한다. Apps Script 편집기의 `Code.gs`에 넣고 기존 배포의 새 버전을 만든다. 같은 리그 규칙을 Node 검증 서버와 Apps Script에서 실행하며, 리그 데이터는 활성 비공개 시트의 `LeagueSnapshots` 탭, 인증 요청·세션·계정 매핑은 Script Properties에 보관한다. 초기화·설정·장애 대응·용량 제한은 [리그 운영 인계](docs/LEAGUE_OPERATIONS.md)를 따른다.

GitHub Actions는 PR에서 테스트·빌드를 실행한다. Pages Source는 GitHub Actions이며 저장소 변수 `PAGES_ENABLED=true`로 main 배포를 활성화했다. main 병합/푸시 또는 main의 수동 실행 시 정적 `dist/`만 배포한다. 실제 가입 설정은 Apps Script 서버에서 별도로 관리한다. 유료 플랜·대체 호스팅·기존 개인 홈페이지 설정은 변경하지 않는다.

## 문서

- [개발 지침](AGENTS.md), [전체 구현 지침](docs/IMPLEMENTATION_BRIEF.md)
- [서비스 규칙](docs/PRODUCT_SPEC.md), [디자인과 UX](docs/UI_UX.md), [승인 시안](docs/design/README.md)
- [Elo와 개인 기록](docs/RATING_POLICY.md), [미정 사항](docs/DECISIONS.md)
- [리그 구현·운영 인계](docs/LEAGUE_OPERATIONS.md), [인증 설계](docs/AUTH_APPS_SCRIPT.md), [실제 인증 배포 기록](docs/AUTH_DEPLOYMENT.md)
- [개인정보·가입 동의 검토안](docs/PRIVACY_DRAFT.md), [경기·예외 규칙 검토안](docs/MATCH_RULES_DRAFT.md): 최신 사용자 결정과 남은 개통 준비

## 개인정보 안내

[처리방침](https://noeyusiohc.github.io/igfl/#privacy)과 [가입 동의 안내](https://noeyusiohc.github.io/igfl/#consent)를 로그인 없이 제공한다. 공개 운영 문의처는 sy.choi@kaist.ac.kr이다. 학교·Google에 확인할 질문은 [별도 목록](docs/PRIVACY_EXTERNAL_CHECKLIST.md)에 정리한다. 안내 게시와 실제 가입 개통은 별개이며 가입·시즌·리그 메일·저장소 승인 스위치는 계속 닫힌다.
