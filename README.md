# IGFL 홈페이지

ISE & GSDS Futsal League. KAIST 이메일 로그인, 선수 등록, 팀 운영, 자율 경기·심판 배정, 결과 확인과 Elo 파워랭킹을 제공한다. 흰 배경과 짙은 초록색 포인트의 승인 디자인을 따른다.

2026-10-16 기준 선수·팀·경기·심판·운영진 화면과 서버 규칙을 구현했다. 자동 테스트 **36개 통과**. 합성 데이터 브라우저에서 양 팀 기록 제출 → 양 팀 확인 → 내부 심판 최종 승인 → 랭킹 갱신을 확인했다. 실제 Apps Script 서버의 공개 리그 조회도 로컬 브라우저에서 연결했다. 실제 이메일 로그인 검증은 [인증 배포 기록](docs/AUTH_DEPLOYMENT.md)에 있다.

**개통 전 상태다.** 개인정보 정책이 미정이라 실제 선수 가입은 서버에서 닫혀 있다. 시즌도 닫혀 있고 최초 운영진·알림 수신자·메일 작업은 아직 설정하지 않았다. 사용자는 Pages 지원 플랜을 나중에 준비하기로 했으며 [저장소](https://github.com/noeyusiohc/igfl)는 비공개를 유지한다. GitHub Pages 출처 연동 검증은 남아 있다. 기존 개인 홈페이지는 건드리지 않는다.

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

`.local/AppsScript.gs`를 생성한다. Apps Script 편집기의 `Code.gs`에 넣고 기존 배포의 새 버전을 만든다. 같은 리그 규칙을 Node 검증 서버와 Apps Script에서 실행하며, 실제 데이터는 기존 비공개 인증 시트의 `LeagueSnapshots` 탭에 보관한다. 초기화·설정·장애 대응·용량 제한은 [리그 운영 인계](docs/LEAGUE_OPERATIONS.md)를 따른다.

GitHub Actions는 PR에서 테스트·빌드를 실행한다. 지원 플랜 준비 후 Pages 설정을 GitHub Actions로 선택하고 저장소 변수 `PAGES_ENABLED=true`를 지정하면 main 배포가 가능하다. 현재 배포는 꺼져 있다. 공개 전환·유료 플랜 변경·대체 호스팅은 임의로 하지 않는다.

## 문서

- [개발 지침](AGENTS.md), [전체 구현 지침](docs/IMPLEMENTATION_BRIEF.md)
- [서비스 규칙](docs/PRODUCT_SPEC.md), [디자인과 UX](docs/UI_UX.md), [승인 시안](docs/design/README.md)
- [Elo와 개인 기록](docs/RATING_POLICY.md), [미정 사항](docs/DECISIONS.md)
- [리그 구현·운영 인계](docs/LEAGUE_OPERATIONS.md), [인증 설계](docs/AUTH_APPS_SCRIPT.md), [실제 인증 배포 기록](docs/AUTH_DEPLOYMENT.md)
