import type { TranslationShape } from "@/app/i18n/types";
import { cosmeticsEn } from "@/app/i18n/locales/en/cosmetics";

export const cosmeticsKo: TranslationShape<typeof cosmeticsEn> = {
  unavailable: "코스메틱을 사용할 수 없음",
  unavailableMessage: "이 MetaSave에서는 코스메틱 편집을 사용할 수 없습니다.",
  eyebrow: "계정 세이브",
  title: "코스메틱",
  unlocked: "지원 코스메틱 {total}개 중 {owned}개 잠금 해제",
  complete: "지원되는 모든 코스메틱이 이미 잠금 해제되었습니다.",
  remaining: {
    one: "지원 코스메틱 {count}개가 잠겨 있습니다.",
    other: "지원 코스메틱 {count}개가 잠겨 있습니다.",
  },
  action: "남은 코스메틱 잠금 해제",
  cosmeticId: "꾸미기 ID",
  lockAll: "모든 꾸미기 잠금",
  presets: "장착과 프리셋은 변경되지 않습니다.",
  lockBlocked: {
    equipped:
      "해제된 꾸미기가 장착되어 있어 전체 잠금이 차단되었습니다. R.E.P.O.에서 장착을 해제하고 게임을 종료한 뒤 최신 MetaSave를 가져오세요.",
    preset:
      "해제된 꾸미기가 저장된 프리셋에 사용되어 전체 잠금이 차단되었습니다. R.E.P.O.에서 프리셋 참조를 제거하고 게임을 종료한 뒤 최신 MetaSave를 가져오세요.",
    unverified:
      "장착 또는 프리셋 참조를 확인할 수 없습니다. 게임의 완전한 MetaSave를 가져오세요. 여기서는 참조를 지우지 않습니다.",
    busy: "파일 작업 중입니다. 완료될 때까지 기다려 주세요.",
    empty: "해제된 지원 꾸미기가 없습니다.",
  },
  lockConfirmTitle: "모든 꾸미기를 잠글까요?",
  lockConfirmBody: {
    one: "작업 사본에서 지원 꾸미기 {count}개의 소유권을 제거합니다.",
    other: "작업 사본에서 지원 꾸미기 {count}개의 소유권을 제거합니다.",
  },
  lockRestrictions:
    "장착 중이거나 프리셋에서 참조하는 꾸미기가 있으면 차단됩니다. 장착, 프리셋, 미지원 소유권은 지우지 않습니다. 변경 사항을 저장하려면 검증된 사본을 다운로드하세요.",
  preservedOwnership: {
    one: "미지원 꾸미기 {count}개의 소유권은 보존됩니다.",
    other: "미지원 꾸미기 {count}개의 소유권은 보존됩니다.",
  },
  confirmLock: {
    one: "{count}개 잠금",
    other: "{count}개 잠금",
  },
  cancelLock: "취소",
  lockChanged: "세이브 또는 소유권이 변경되었습니다. 취소하고 전체 잠금을 다시 검토하세요.",
  pendingHistoryField: "꾸미기 기록",
  pendingHistoryOriginal: "원래 기록",
  pendingHistoryUpdated: "변경된 기록",
  pendingField: "지원 코스메틱",
  pendingValue: "{count}개 잠금 해제",
};
