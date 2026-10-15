# IGFL 홈페이지

KAIST 이메일 인증으로 선수를 등록하고 팀들이 자율적으로 치른 공식 경기 결과를 바탕으로 Elo 파워랭킹을 제공하는 홈페이지다.

2026년 10월 16일 구현을 시작했다. [별도 비공개 저장소](https://github.com/noeyusiohc/igfl)에 소개·이메일 로그인 화면과 Apps Script 인증 서버의 첫 구현을 둔다. 첫 검증 범위는 이메일 인증이며 전체 리그 운영 기능은 아직 구현 전이다. 공식 선수 정보를 받지 않으며 합성 순위나 시안용 인증번호를 서비스에 표시하지 않는다.

현재 GitHub 계정의 Pages 설정은 비공개 저장소 배포에 업그레이드 또는 공개 전환을 요구한다. 저장소는 비공개로 유지한다. **실제 Pages → Apps Script → 수신 메일 → 로그인 검증은 아직 완료되지 않았다.**

## 로컬 실행

Node.js 22 이상, 외부 패키지 설치 없이 실행한다.

```sh
node --test
node scripts/build.mjs
node scripts/serve.mjs
```

`http://127.0.0.1:4173`에서 확인한다. `config.json`의 `authEndpoint`가 비어 있으면 메일을 보내지 않고 준비 중 안내를 표시한다. 실제 연결 방법과 검증 상태는 [인증 배포 안내](docs/AUTH_DEPLOYMENT.md)를 따른다. `dist/`에는 공개 프런트엔드만 복사한다.

## 문서

- [Codex agent 지침](AGENTS.md): 구현자가 먼저 읽을 규칙과 작업 범위.
- [최종 구현 지침서](docs/IMPLEMENTATION_BRIEF.md): 지금까지 확정한 기능과 디자인, 역할·승인 흐름, 구현·검증과 후속 요청문.
- [서비스 기획안](docs/PRODUCT_SPEC.md): 확정된 참가·팀·경기·승인·공개 범위와 인수 기준.
- [결정할 사항과 구현 제안](docs/DECISIONS.md): 미정 규칙, 기술 구성, 데이터 구조와 구현 순서.
- [Apps Script 인증 설계](docs/AUTH_APPS_SCRIPT.md): 이메일 코드 로그인·세션·CORS·할당량과 검증 범위.
- [Elo와 개인 기록 규칙](docs/RATING_POLICY.md): 위임에 따라 채택한 계산값·최근 5경기·공동순위·심판 공로.
- [UI와 UX 기획](docs/UI_UX.md): 소개 홈과 하위 페이지 구조, 카드와 필터, 개인 기록의 표시 원칙.
- [승인 시안과 사용 안내](docs/design/README.md): 같은 디자인을 다른 환경에서 구현하기 위한 보관 원본.

## 이어서 구현할 때

아래 문서와 현재 검증 상태를 읽고 계속 진행한다. 저장소 소유자와 서비스 설정 등 미정 값은 임의로 채우지 않는다.

```text
이 저장소의 AGENTS.md와 docs/IMPLEMENTATION_BRIEF.md를 먼저 읽고
docs/PRODUCT_SPEC.md, docs/UI_UX.md, docs/DECISIONS.md 및
docs/design/igfl-approved-mockup.html을 기준으로 IGFL 홈페이지 구현을 시작해줘.

승인된 디자인과 확정된 운영 규칙을 유지해줘.
지금 필요한 미정 사항만 묶어 확인하면서 독립적인 작업은 진행해줘.
기존 개인 GitHub 홈페이지와 로컬 Git 저장소를 보존해줘.
인증·권한·영구 저장·이메일·심판 배정·경기 확정을 실제 백엔드에 연결하고,
docs/IMPLEMENTATION_BRIEF.md의 검증 기준을 확인해줘.
외부 저장소·계정·배포는 이 대화에서 정한 소유자와 허용 범위를 따라줘.
```

## 저장소와 호스팅 방향

사용자의 기존 개인 계정의 `noeyusiohc/igfl` 비공개 저장소를 사용한다. 기존 개인 홈페이지는 보존한다. 사용자 허락 없이 공개 전환하거나 플랜·유료 서비스를 추가하지 않는다. 실제 호스트와 전체 리그 데이터 저장소는 미정이다.

공개 저장소의 GitHub Pages는 무료로 사용할 수 있으며 기본 주소는 `<계정>.github.io/<저장소>/`다. 비공개 저장소 Pages는 지원 유료 플랜이 필요하다. 인증·데이터베이스·메일·이미지 저장소는 별도 서비스다. 이메일 6자리 OTP 로그인은 Apps Script와 비공개 Sheets를 우선 사용하며 실제 Pages CORS·세션·할당량을 검증한다. 비밀번호는 사용하지 않는다. 상세한 공식 출처와 구분은 [호스팅 결정 사항](docs/DECISIONS.md)에 있다.
