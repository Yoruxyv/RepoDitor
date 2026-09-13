import type { TranslationShape } from "@/app/i18n/types";
import { policiesEn } from "@/app/i18n/locales/en/policies";

export const policiesKo: TranslationShape<typeof policiesEn> = {
  licenseTitle: "라이선스",
  privacyTitle: "데이터 및 개인정보",
  privacyOne: "세이브 내용은 로컬에서 처리되며 RepoDitor Web에 저장되지 않습니다.",
  privacyTwo:
    "세이브 파일과 복호화된 JSON은 업로드되지 않습니다. 선택적 Steam 아바타 보강은 검증된 Steam ID만 동일 출처의 RepoDitor 엔드포인트로 전송합니다. 테마와 언어 설정은 로컬에 저장되지만 세이브 데이터는 해당 저장소를 사용하지 않습니다.",
  securityTitle: "보안",
  securityOne:
    "RepoDitor는 지원되는 세이브 구조를 검증하고 변경 사항을 메모리에 준비하며 다운로드 전에 각 암호화 내보내기를 검증합니다.",
  securityBeforeLink: "취약점은 저장소의",
  securityLink: "보안 권고 양식",
  securityAfterLink:
    "을 통해 비공개로 신고하세요. 실제 세이브 파일이나 복호화된 데이터를 공개 신고에 포함하지 마세요.",
  termsTitle: "이용 약관",
  termsOne: "RepoDitor는 독립 커뮤니티 도구이며 semiwork와 제휴하지 않습니다.",
  termsTwo:
    "세이브 복사본을 사용하고 내보내기 전에 변경 사항을 검토하세요. 백업과 다운로드한 파일 사용에 대한 책임은 사용자에게 있습니다.",
};
