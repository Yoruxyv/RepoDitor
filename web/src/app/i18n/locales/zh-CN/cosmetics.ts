import type { TranslationShape } from "@/app/i18n/types";
import { cosmeticsEn } from "@/app/i18n/locales/en/cosmetics";

export const cosmeticsZhCn: TranslationShape<typeof cosmeticsEn> = {
  unavailable: "装扮不可用",
  unavailableMessage: "此 MetaSave 无法使用装扮编辑。",
  eyebrow: "账户存档",
  title: "装扮",
  unlocked: "已解锁 {owned}/{total} 个受支持装扮",
  complete: "所有受支持的装扮都已解锁。",
  remaining: {
    one: "仍有 {count} 个受支持装扮未解锁。",
    other: "仍有 {count} 个受支持装扮未解锁。",
  },
  action: "解锁剩余装扮",
  cosmeticId: "装饰 ID",
  lockAll: "锁定所有装饰",
  presets: "不会修改装备和预设。",
  lockBlocked: {
    equipped:
      "已解锁的装饰仍在装备中，因此无法全部锁定。请在 R.E.P.O. 中卸下，退出游戏，再导入更新的 MetaSave。",
    preset:
      "已解锁的装饰被已保存的预设引用，因此无法全部锁定。请在 R.E.P.O. 中移除预设引用，退出游戏，再导入更新的 MetaSave。",
    unverified: "无法验证装备或预设引用。请导入游戏生成的完整 MetaSave。此处不会清除引用。",
    busy: "文件操作正在进行，请等待完成。",
    empty: "当前没有已解锁的受支持装饰。",
  },
  lockConfirmTitle: "锁定所有装饰？",
  lockConfirmBody: {
    one: "这将从工作副本中移除 {count} 个受支持装饰的所有权。",
    other: "这将从工作副本中移除 {count} 个受支持装饰的所有权。",
  },
  lockRestrictions:
    "如果装饰仍在装备中或被预设引用，此操作将被阻止。不会清除装备、预设或不支持的所有权。请下载验证后的副本以保存更改。",
  preservedOwnership: {
    one: "保留 {count} 个不支持的已拥有装饰。",
    other: "保留 {count} 个不支持的已拥有装饰。",
  },
  confirmLock: {
    one: "锁定 {count} 个装饰",
    other: "锁定 {count} 个装饰",
  },
  cancelLock: "取消",
  lockChanged: "存档或所有权已更改。请取消并重新检查全部锁定操作。",
  pendingHistoryField: "装饰历史",
  pendingHistoryOriginal: "原始历史",
  pendingHistoryUpdated: "更新后的历史",
  pendingField: "受支持的装扮",
  pendingValue: "已解锁 {count} 个",
};
