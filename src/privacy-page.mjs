import { PRIVACY } from "./privacy-content.mjs";
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function privacyPage(consents = false) {
  const contact = `<a href="mailto:${PRIVACY.contact}">${PRIVACY.contact}</a>`;
  const links = `<div class="policy-links"><a href="#privacy">개인정보 처리방침</a><a href="#consent">가입 동의 안내</a><a href="mailto:${PRIVACY.contact}">운영 문의</a></div>`;
  const heading = `<div class="page-heading"><div class="eyebrow">IGFL PRIVACY</div><h1>${consents ? "가입 동의 안내" : "개인정보 처리방침"}</h1><p class="muted">우리 리그에서 어떤 정보를 쓰고, 어떻게 보관하고 지우는지 안내해요.</p></div>`;
  const status = `<aside class="notice policy-status"><strong>현재 실제 선수 가입은 닫혀 있어요.</strong><p>이메일 인증·로그인은 제공하고 있어요. 선수 등록 안내는 개통 전 준비 중이며, 학교·Google 서비스의 처리 조건을 확인한 뒤 최종 안내를 반영할 예정이에요. 이 페이지에서는 개인정보를 입력받거나 동의를 제출받지 않아요.</p></aside>`;
  const meta = `<p class="caption muted" data-collection-version="${PRIVACY.collectionVersion}" data-public-version="${PRIVACY.publicVersion}">게시·적용일 ${PRIVACY.date} · 안내 버전 2</p>`;
  if (consents)
    return `<article class="policy-page">${heading}${meta}${status}${links}
    <section class="policy-section"><h2>이메일 인증 전에</h2><p>${escape(PRIVACY.authNotice)}</p><p>인증만으로 선수 가입이나 공개 동의가 완료되지 않아요.</p></section>
    <section class="policy-section" id="collection-consent"><span class="badge">필수 1</span><h2>개인정보 수집 및 이용 동의</h2><p>${escape(PRIVACY.collectionNotice)}</p><p class="consent-example">가입 시 확인할 문구: 안내를 읽고 개인정보 수집·이용에 동의해요. (필수)</p></section>
    <section class="policy-section" id="public-consent"><span class="badge">필수 2</span><h2>이름·연구실 및 리그 기록 공개 동의</h2><p>${escape(PRIVACY.publicNotice)}</p><p class="consent-example">가입 시 확인할 문구: 이름·연구실과 리그 기록 공개에 동의해요. (필수)</p></section>
    <section class="policy-section"><h2>동의와 선택 항목</h2><p>개통 후 실제 가입 화면에서 두 항목에 각각 동의해야 등록할 수 있어요. 체크박스는 미리 선택하지 않고 동의한 버전과 시각을 각각 기록해요. 심판 가능 여부와 가입 문의할 팀은 선택할 수 있으며 무소속 등록도 가능해요.</p><p>생년월일·주민등록번호·계좌번호는 수집하지 않아요. 심판 수당은 경기당 20,000원으로, 양 팀이 10,000원씩 심판에게 직접 지급해요.</p></section>
    <section class="policy-section"><h2>문의·동의 철회</h2><p>운영 담당: IGFL 운영진 · ${contact}</p><p>개인정보 열람·정정·삭제·처리 정지·공개 동의 철회를 요청할 수 있어요. 공개 동의 철회는 회원 탈퇴와 같은 개인 정보 삭제 절차로 처리해요.</p></section>${links}</article>`;
  return `<article class="policy-page">${heading}${meta}${status}${links}
    <section class="policy-section"><h2>1. 운영자와 적용 범위</h2><p>IGFL 운영진은 ISE·GSDS 풋살 리그 홈페이지의 회원 확인, 팀·경기 운영 및 문의 처리를 위해 필요한 정보를 처리합니다. 운영 문의 및 개인정보 요청은 ${contact}로 접수합니다.</p><p>현재 제공 중인 이메일 인증과 아래 선수 가입 준비 안내를 구분합니다. 선수 정보의 수집은 실제 가입 개통 및 별도 동의 이후 시작합니다.</p></section>
    <section class="policy-section"><h2>2. 처리 목적과 항목</h2><div class="table-scroll"><table class="policy-table"><caption class="sr-only">처리 목적별 개인정보 항목</caption><thead><tr><th scope="col">목적</th><th scope="col">처리 항목</th></tr></thead><tbody>
      <tr><th scope="row">이메일 인증·로그인</th><td>KAIST 이메일, 요청 목적·시각·만료·실패 횟수·발송 상태, 인증/세션 검증값, 내부 계정 ID</td></tr>
      <tr><th scope="row">선수 자격·중복 확인</th><td>이름, 학번 또는 사번, 참가 자격, 소속 학과·부서·연구실, 지도교수 및 해당 소속 정보</td></tr>
      <tr><th scope="row">팀·경기·기록 운영</th><td>팀 소속·대표 역할, 심판 가능 여부, 출전·득점·심판 활동, 결과 제출·확인 기록, 문의·이의 내용</td></tr>
      <tr><th scope="row">동의·안전한 운영</th><td>동의 버전·시각, 필요한 최소 요청·권한 변경·운영 이력</td></tr>
    </tbody></table></div><p>생년월일·주민등록번호·계좌번호는 수집하지 않습니다. 팀 선택과 심판 활동 희망은 선택 사항입니다. 문의·팀 소개·이미지에는 불필요한 타인의 개인정보를 넣지 마세요.</p></section>
    <section class="policy-section"><h2>3. 공개 범위와 동의</h2><p>${escape(PRIVACY.publicNotice)}</p><p>팀 페이지에서는 소속 팀원의 이름과 연구실을 보여줍니다. 일반 방문자에게 전체 경기별 출전 명단이나 비공개 제출 자료를 제공하지 않습니다. 비공개 프로필은 본인과 운영진만 확인하며, 팀 대표·심판은 경기 운영에 필요한 명단과 기록만 확인합니다.</p><p>회원 가입 시 수집·이용 동의와 공개 동의를 각각 받으며 버전과 시각을 기록합니다. <a href="#consent">가입 동의 안내 읽기 →</a></p></section>
    <section class="policy-section"><h2>4. 보유 기간</h2><div class="table-scroll"><table class="policy-table"><caption class="sr-only">개인정보별 보유 기간과 종료 처리</caption><thead><tr><th scope="col">정보</th><th scope="col">기간과 종료 처리</th></tr></thead><tbody>
      <tr><th scope="row">인증 요청</th><td>번호는 발급 후 5분 유효·일회용. 불필요한 코드 검증값은 사용·만료 후 정리하고 남용 방지용 최소 요청 기록은 발급 후 24시간 기준으로 정리합니다.</td></tr>
      <tr><th scope="row">로그인 세션</th><td>최대 12시간 유효하며 로그아웃·회원 탈퇴 시 즉시 무효화합니다. 선수 미등록 인증 계정은 마지막 이용 후 24시간 기준으로 정리합니다.</td></tr>
      <tr><th scope="row">회원 기본·자격 정보</th><td>회원 탈퇴·동의 철회·서비스 종료 중 먼저 발생하는 시점까지 보유하고 지체 없이 삭제합니다.</td></tr>
      <tr><th scope="row">개인 시즌 기록</th><td>회원 유지 중이며 해당 시즌 종료 후 최대 2년 이내 보유합니다. 탈퇴·공개 동의 철회 시 개인 정보와 연결을 삭제합니다. 시즌 종료일은 시즌 운영 시 공지합니다.</td></tr>
      <tr><th scope="row">최소 운영 이력</th><td>발생 후 90일을 상한으로 정리합니다. 탈퇴 시 개인 연결을 제거하며 별도 근거 없이 이메일·학번을 남기지 않습니다.</td></tr>
      <tr><th scope="row">팀 결과·Elo</th><td>리그 아카이브 운영 중 보존하되 탈퇴자를 식별하거나 다시 연결할 수 있는 개인 정보는 제거합니다.</td></tr>
    </tbody></table></div><p>저장 항목은 시간별 자동 정리 대상입니다. 정상 실행에서도 기준 시각 후 약 한 시간의 지연이 추가될 수 있고, 장애 시에는 운영자가 재처리합니다. 인증 유효성은 저장 항목 정리 시점과 관계없이 만료 즉시 거부합니다.</p></section>
    <section class="policy-section"><h2>5. 회원 탈퇴와 파기</h2><p>팀 탈퇴는 무소속 전환이며 회원과 지난 개인 기록을 유지합니다. 회원 탈퇴는 계정 접근·세션을 차단하고 이름·이메일·학번/사번·연구실·지도교수·팀 역할·명단·득점·심판 기록 등의 개인 정보와 연결을 삭제하는 별도 절차입니다. 이미 확정한 팀 경기 점수와 Elo는 보존합니다.</p><p>현재 데이터를 정리한 새 파일을 검증해 운영 파일로 전환하고, 운영자가 이전 파일·사본·휴지통을 별도로 파기합니다. 이미지·자유 입력의 개인 식별 정보도 확인합니다. 이전 파일이 남아 있으면 전체 파기가 끝났다고 안내하지 않습니다. 지체 없는 처리를 원칙으로 하며 처리 완료 안내 목표는 영업일 5일 이내입니다. 이 목표가 5일간 보관을 허용하는 것은 아닙니다.</p><p>이전 파일이나 원시 백업을 그대로 운영에 복원하지 않습니다. Google의 관리자 복구·보관 정책은 아래 확인 항목과 별개로 적용될 수 있습니다. 인터넷 방문자가 저장한 공개 사본은 회수하기 어려울 수 있습니다.</p></section>
    <section class="policy-section"><h2>6. 외부 서비스 이용</h2><div class="table-scroll"><table class="policy-table"><thead><tr><th scope="col">서비스</th><th scope="col">이용 내용</th></tr></thead><tbody>
      <tr><th scope="row">Google</th><td>Apps Script의 이메일 인증·서버 처리, MailApp 메일 발송, Script Properties의 인증 기록 보관, 비공개 Sheets의 리그 데이터 보관에 이용합니다.</td></tr>
      <tr><th scope="row">GitHub Pages</th><td>공개 홈페이지의 화면과 정적 파일 제공에 이용합니다. 비공개 선수 정보·인증 검증값·서버 비밀키를 저장소나 배포 파일에 넣지 않습니다.</td></tr>
    </tbody></table></div><p>인증 메일에는 6자리 인증번호를 보내며, 선수의 비공개 프로필을 리그 알림 메일에 넣지 않습니다. 문의 메일의 불필요한 첨부·민감한 정보는 보내지 마세요.</p><p class="policy-pending">가입 개통 전 확인 사항: 학교 계정의 리그 운영 사용 허용, Google 계약상 처리 주체·연락처, 실제 처리/보관 국가·기간과 국외 이전 관련 안내, 관리자 복구·Vault·백업의 적용 범위. 확인되지 않은 국가나 삭제 기간을 확정해 안내하지 않습니다. 확인 결과를 반영하기 전에는 선수 가입을 열지 않습니다.</p></section>
    <section class="policy-section"><h2>7. 안전한 관리와 브라우저 저장</h2><p>서버가 로그인·현재 역할을 확인하고 필요한 정보만 제공합니다. 인증번호와 세션 토큰 원문을 서버 저장소에 보관하지 않으며 메일 발송·검증 요청을 제한합니다. HTTPS로 통신하고 Sheets는 일반 이용자에게 공유하지 않습니다.</p><p>브라우저의 세션 저장소(sessionStorage)에 현재 탭의 로그인 토큰을 보관합니다. 로그아웃하거나 탭을 닫으면 브라우저의 해당 세션은 종료되며 서버 세션은 최대 12시간 유효합니다. IGFL은 광고 추적·별도 방문 분석 도구를 사용하지 않습니다. Google·GitHub가 서비스 제공 중 처리하는 접속 정보는 각 사업자의 정책도 적용됩니다.</p></section>
    <section class="policy-section"><h2>8. 열람·정정·삭제·처리 정지 요청</h2><p>본인 정보의 열람·정정·삭제·처리 정지와 동의 철회를 ${contact}로 요청할 수 있습니다. 요청자는 필요한 최소 범위에서 본인 확인을 거칩니다. 공개 동의 철회는 회원 탈퇴와 같은 개인 정보 삭제 절차로 처리하며 선수 회원 이용이 종료됩니다.</p><p>운영 담당은 IGFL 운영진입니다. 권한 없는 사람에게 자료를 제공하지 않으며, 요청의 처리 결과와 추가로 필요한 사항을 안내합니다.</p></section>
    <section class="policy-section"><h2>9. 안내 변경</h2><p>이 안내는 ${PRIVACY.date} 게시·적용했습니다. 현재는 선수 가입 준비 단계이며 수집 항목·공개 범위·보관 방식이 바뀌면 홈페이지에서 변경 내용을 안내하고 필요한 동의를 다시 받습니다.</p></section>${links}</article>`;
}
