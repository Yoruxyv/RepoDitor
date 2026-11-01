import type { TranslationShape } from "@/app/i18n/types";
import { cosmeticsEn } from "@/app/i18n/locales/en/cosmetics";

export const cosmeticsJa: TranslationShape<typeof cosmeticsEn> = {
  unavailable: "コスメティックを利用できません",
  unavailableMessage: "この MetaSave ではコスメティックを編集できません。",
  eyebrow: "アカウントセーブ",
  title: "コスメティック",
  unlocked: "対応コスメティック {total} 個中 {owned} 個を解放済み",
  complete: "対応コスメティックはすべて解放済みです。",
  remaining: {
    one: "対応コスメティックが {count} 個ロックされています。",
    other: "対応コスメティックが {count} 個ロックされています。",
  },
  action: "残りのコスメティックを解放",
  cosmeticId: "コスメティックID",
  lockAll: "すべてのコスメティックをロック",
  presets: "装備とプリセットは変更されません。",
  lockBlocked: {
    equipped:
      "解放済みのコスメティックが装備されているため、一括ロックできません。R.E.P.O. で装備を外し、ゲームを終了してから最新の MetaSave を読み込んでください。",
    preset:
      "解放済みのコスメティックが保存済みプリセットに含まれるため、一括ロックできません。R.E.P.O. でプリセットから外し、ゲームを終了して最新の MetaSave を読み込んでください。",
    unverified:
      "装備またはプリセットの参照を確認できません。ゲームの完全な MetaSave を読み込んでください。ここでは参照を削除しません。",
    busy: "ファイル操作中です。完了するまでお待ちください。",
    empty: "解放済みの対応コスメティックはありません。",
  },
  lockConfirmTitle: "すべてのコスメティックをロックしますか？",
  lockConfirmBody: {
    one: "作業中のコピーから、対応コスメティック {count} 個の所有権を削除します。",
    other: "作業中のコピーから、対応コスメティック {count} 個の所有権を削除します。",
  },
  lockRestrictions:
    "装備中またはプリセットで参照されるものがある場合は実行できません。装備、プリセット、未対応の所有権は削除しません。変更を保存するには検証済みコピーをダウンロードしてください。",
  preservedOwnership: {
    one: "未対応の所有コスメティック {count} 個は保持されます。",
    other: "未対応の所有コスメティック {count} 個は保持されます。",
  },
  confirmLock: {
    one: "{count} 個をロック",
    other: "{count} 個をロック",
  },
  cancelLock: "キャンセル",
  lockChanged:
    "セーブまたは所有状態が変更されました。キャンセルして一括ロックを確認し直してください。",
  pendingHistoryField: "コスメティック履歴",
  pendingHistoryOriginal: "元の履歴",
  pendingHistoryUpdated: "更新された履歴",
  pendingField: "対応コスメティック",
  pendingValue: "{count} 個解放済み",
};
