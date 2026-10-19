# Sheets·인증 저장소와 수동 파기 운영 안내

## 2026-10-19 최신 결정: 선수·팀 모집 시범 개통

사용자는 현재 정보 자동 정리·새 시트 검증 전환과 이전 파일/사본/휴지통의 운영자 수동 파기, 삭제 자료 복구 요청·복원 사용 금지 원칙으로 시범 운영을 시작하기로 했다. 선수 가입·팀 신청만 개통하고 경기 등록(`LEAGUE_SEASON_OPEN`)·리그 메일 자동 발송(`LEAGUE_EMAILS_ENABLED`)은 계속 닫는다. 인증은 24시간 전체 예약 300회, 이메일별 시간당 5회·60초 간격·코드 5분·세션 12시간을 유지한다. Google 실제 잔여 수신자 한도도 계속 강제한다.

`PRIVACY_STORAGE_APPROVED`는 이 수동 파기 시범 운영에 대한 운영자의 결정이며 학교·Google의 승인이나 법적 적합성·공급자 완전 파기 확인을 뜻하지 않는다. 외부 처리 주체·국가·복구/Vault/백업 세부 조건은 확인 중으로 남기고 이를 확인 완료로 기재하지 않는다. 공통 안내/동의는 2026-10-19 v3다. 자세한 절차는 [모집 개통 인계](RECRUITMENT_LAUNCH.md)를 따른다. 아래 이전 날짜의 가입 차단 기록은 당시 상태다.

2026-10-18 사용자 결정: 리그는 비공개 Sheets, 인증 요청·세션·계정 매핑은 Apps Script **Script Properties**를 사용한다. 탈퇴·보관 기간 정리 후 새 빈 Sheets를 만들어 정리된 현재 데이터만 쓰고 검증 후 전환한다. 이전 파일·사본·휴지통 삭제는 운영자가 직접 한다. 실제 가입·시즌·리그 메일은 계속 닫는다.

## 저장 구조

| 위치 | 저장 내용 | 접근 |
| --- | --- | --- |
| GitHub Pages | UI·공개 설정·코드 | 공개. 개인정보·서버 키 없음 |
| Script Properties `IGFL_AUTH:*` | 인증 요청 메타데이터·HMAC 검증값·세션 검증값·이메일과 내부 계정 ID 매핑 | 프로젝트 소유자/편집자·서버만 |
| 비공개 Sheets `LeagueSnapshots` | 회원 프로필·팀·경기·승인·알림 등 리그 상태 | 서버가 권한별로 필요한 부분만 반환 |
| Script Properties 운영 메타데이터 | 현재 파일/스냅샷 포인터·정리 상태·수동 삭제 대기 파일 ID | 소유자 전용 진단. 탈퇴자 이름·이메일을 삭제 원장에 남기지 않음 |

Properties는 독립된 유료 DB가 아닌 Apps Script 내부 문자열 저장소다. 버전 이력이 있는 셀에 인증 기록을 반복해서 남기지 않는다. 원문 OTP·원문 세션 토큰은 서버 저장하지 않는다. 이 방식이 Google 내부 백업까지 즉시 물리적으로 삭제함을 보장하지는 않는다. [Properties 문서](https://developers.google.com/apps-script/guides/properties).

Google 한도는 값당 9 KB·저장소당 500 KB이며 일일 읽기/쓰기는 일반 계정 50,000회·Workspace 500,000회다. 코드에서는 인증/관리용 쓰기를 값당 8,000바이트·전체 속성 합계 420,000바이트에서 차단해 여유를 둔다. `inspectStorageStatus()`의 `propertiesBytes`를 확인한다. 100명 규모라도 무제한 저장소로 취급하지 않으며 가입 개통 전 인증 발송 예산 50회/24시간은 별도 검토한다. [할당량](https://developers.google.com/apps-script/guides/services/quotas).

## 기존 환경 최초 전환

1. 테스트·정적 빌드·GAS 빌드를 통과한 번들을 같은 Apps Script 프로젝트에 저장한다. 기존 Sheets/메일 두 OAuth 범위만 사용한다. 기존 시간별 `runScheduledPrivacyMaintenance` 트리거는 유지한다.
2. **기존 웹 앱 배포를 새 버전으로 갱신한 다음** `migrateAuthenticationStorage()`를 편집기에서 실행한다. 이전 버전이 배포 중인 상태에서는 옛 코드가 시트에 계속 쓸 수 있다. 배포 직전에 시작된 이전 버전 실행도 모두 종료됐는지 실행 목록에서 확인한 뒤 이전한다. 전환 전 새 코드의 인증 쓰기는 `AUTH_MIGRATION_REQUIRED`로 차단된다. 공개 리그 조회와 개통 스위치를 인증 이전 완료로 오인하지 않는다.
3. 이전 시트의 유효 세션과 계정 ID, 24시간 이내 인증 메타데이터를 Properties에 복사·재조회 검증한다. 만료 세션·만료 코드 해시는 가져오지 않는다. 모두 검증한 뒤 `AUTH_STORAGE_VERSION=properties-v1`을 한 번에 확정한다. 중단되면 같은 함수를 재실행한다. 확정 후 옛 인증 시트로 되돌아가는 fallback은 없다.
4. `rotateLeagueStorage()`를 실행한다. 새 빈 파일에 현재 리그 상태만 기록하고 전체 JSON을 다시 읽어 정확히 대조한다. 파일 ID와 스냅샷 포인터를 **하나의 `LEAGUE_ACTIVE_SNAPSHOT` 속성**으로 전환한다. 원본 Drive 파일을 복사한 뒤 지우는 방식을 쓰지 않는다.
5. `runPrivacyMaintenance()`와 `inspectStorageStatus()`로 현재 파일·인증 저장 방식·정리 성공·가입/시즌/리그 메일 닫힘을 확인한다. 예전 `AUTH_SHEET_ID`는 초기 이전 출처 식별용이며 전환 후 읽기/쓰기는 포인터의 새 파일 ID를 따른다. 비밀키를 바꾸거나 `initializeAuth()`를 다시 실행하지 않는다.
6. `verifyStorageWorkflow()`는 별도 합성 파일과 실제 속성의 격리된 접두사에서 동일 탈퇴·전환 코드를 실행한다. 메일을 보내지 않으며 운영 포인터를 바꾸지 않는다. 시험 파일도 삭제 대기 목록에 남긴다. 완료된 시험 재실행은 거절한다.

## 탈퇴와 정기 정리

회원 탈퇴 요청은 인증 접근을 먼저 막는 재시도 표시를 남기고, 현재 리그에서 개인 정보와 연결을 제거한다. 계정 매핑·인증 요청·세션을 삭제하고 정리된 상태로 새 파일을 생성·검증·전환한다. 팀 점수·Elo는 유지한다. 이전 파일은 `IGFL_RETIRED:<파일 ID>`의 `pending-owner-deletion`으로 남는다. 이전 파일의 변경 이력이 이 시점에 삭제된 것은 아니다.

기존 시간별 트리거는 인증 기록 정리·미완료 탈퇴 재시도·90일 운영 기록·시즌 종료 후 2년 개인 기록 정리를 수행한다. 리그 보관 기간 정리로 상태가 바뀌었을 때도 새 파일로 전환한다. 변화가 없는 매시간마다 파일을 만들지는 않는다. 인증 기록은 Properties에서 직접 정리하므로 인증만으로 시트를 교체하지 않는다. 인증 유효성은 만료 즉시 거부하며 저장 항목 정리는 실행 간격/장애에 따라 늦어질 수 있다.

## 운영자가 이전 파일을 지우는 순서

1. Apps Script에서 `inspectStorageStatus()`를 실행한다. `activeSheet`가 현재 운영 파일이며 **삭제하면 안 된다**. `retiredFiles`의 링크만 삭제 대상으로 검토한다. 실제 파일 ID는 공개 저장소에 기록하지 않는다.
2. 이전 파일·다운로드·사본·동기화된 백업을 확인한다. 팀 이미지와 자유 입력에 남은 탈퇴자 이름/연락처도 확인해 먼저 현재 데이터에서 정리하고 다시 전환한다. 자동 도구는 임의 사진의 얼굴·모든 자유 입력의 이름을 판별하지 않는다.
3. 삭제 대기 파일을 Drive 휴지통으로 옮기고, 내용/대상을 확인한 다음 소유자가 직접 영구 삭제한다. 휴지통에만 남긴 상태를 파기 완료로 표시하지 않는다. 파일 전체를 지우면 그 파일의 변경 이력도 일반 사용자 접근에서 제거된다.
4. 삭제한 파일 ID를 Script Property `MANUALLY_DELETED_SHEET_ID`에 입력하고 `recordManualFileDeletion()`을 실행해 완료를 기록한다. 현재 운영 파일이나 목록에 없는 파일 ID는 거절한다. **운영자 신고**이며 Google 내부 백업/Vault의 물리적 삭제 증명이 아니다. 완료된 파일을 복원하거나 운영 포인터에 다시 지정하지 않는다.
5. 삭제 대기 목록은 정기적으로 확인하고 탈퇴 요청 시에는 지체 없이 처리한다. 앱의 탈퇴 완료와 운영자의 이전 파일 파기 완료를 구별한다. 남은 파일이 있으면 개인정보 파기 전체가 완료됐다고 안내하지 않는다.

Google 도움말에는 소유자의 변경 이력 삭제 UI도 소개돼 있다. 다만 현재 계정의 실제 메뉴에서는 해당 항목을 확인하지 못했으므로 이 운영 절차는 그 기능에 의존하지 않는다. Drive API는 native Sheets의 개별 revision 삭제를 지원하지 않는다. [Docs 도움말](https://support.google.com/docs/answer/190843?hl=ko), [Drive revision 문서](https://developers.google.com/workspace/drive/api/guides/manage-revisions).

## 실패·복구

`SHEET_ROTATION_JOB`은 원본 포인터·새 파일 ID·정리 사유만 기록한다. 미완료 작업이 있으면 다른 리그 변경 전에 같은 새 파일에서 재검증/전환을 마친다. 쓰기·검증·포인터 확정 실패 전에는 원래 포인터를 유지한다. 포인터 확정 후 중단됐다면 원본으로 복구하지 않고 삭제 대기 등록만 마친다. 탈퇴 재시도 표시는 전환이 확인될 때까지 유지되며 이전 세션/재로그인을 막는다. 새 파일 생성 중 응답을 받지 못해 ID가 없으면 자동 반복 생성하지 않고 `SHEET_CREATION_REVIEW_REQUIRED`로 보류한다.

이 경우 `inspectStorageStatus()`의 `rotation.createdAt`에 대응하는 `IGFL League — Clean <시각>` 파일을 Drive에서 찾아 고아 파일 여부를 먼저 확인한다. 필요한 파일을 수동 정리한 후 소유자가 `acknowledgeUncertainSheetCreation()`으로 검토 사실을 기록한다. 이후 원래 탈퇴는 `runPrivacyMaintenance()`로 재시도하고, 일반 수동 전환은 `rotateLeagueStorage()`로 다시 요청한다. 이 함수는 파일을 삭제하거나 이전 데이터로 복원하지 않는다.

원시 이전 파일·Properties 덤프를 운영으로 복원하는 도구는 제공하지 않는다. 외부 백업을 쓰기 시작하려면 삭제 대상 재적용·이전 인증 전부 폐기·권한/결과 검증을 포함한 별도 복구 절차를 먼저 구현한다. 부분 쓰기 실패에서 현재 포인터를 보존하는 것은 백업 복원 허가가 아니다.

Workspace 관리자 복구·Vault hold·외부 백업 정책은 별도 확인 대상이다. 일반 파일 삭제만으로 이를 해제하지 않는다. [관리자 복구 설명](https://knowledge.workspace.google.com/admin/drive/recover-deleted-files-and-folders-for-drive-users?hl=en). Google 처리 고지·학교 계정 정책·운영자 수동 파기 절차를 마무리하기 전 `PRIVACY_STORAGE_APPROVED`를 임의 승인하지 않고 실제 가입을 열지 않는다.
