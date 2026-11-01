import { resolveLocalizedMessage, type Translate } from "@/app/i18n/catalog";
import { approvedOwnedCosmeticIds, inspectMetaCosmetics } from "@/features/cosmetics/cosmetics";
import type { PendingEdit } from "@/features/save-file/pendingEdits";
import type { EditSession } from "@/features/save-file/session";
import { parseSaveJson, serializeSaveJson } from "@/features/save-file/serialization";

export function getCosmeticPendingEdits(
  session: EditSession,
  t: Translate = (key, values, count) => resolveLocalizedMessage("en", key, values, count),
  formatNumber: (value: number) => string = String,
): PendingEdit[] {
  if (session.originalKind !== "meta") {
    return [];
  }

  const subject = t("cosmetics.title");
  const pendingField = t("cosmetics.pendingField");
  const pendingValue = (count: number) =>
    t("cosmetics.pendingValue", { count: formatNumber(count) });

  try {
    const baselineData = parseSaveJson(session.baselineSource);
    const baselineIds = approvedOwnedCosmeticIds(baselineData);
    const workingIds = approvedOwnedCosmeticIds(session.working);
    const baseline = inspectMetaCosmetics(baselineData);
    const working = inspectMetaCosmetics(session.working);
    if (
      baselineIds.length === workingIds.length &&
      baselineIds.every((id, index) => id === workingIds[index])
    ) {
      if (
        serializeSaveJson({ cosmeticHistory: baselineData.cosmeticHistory }) ===
        serializeSaveJson({ cosmeticHistory: session.working.cosmeticHistory })
      )
        return [];
      return [
        {
          id: "cosmetics:history",
          subject,
          field: t("cosmetics.pendingHistoryField"),
          before: t("cosmetics.pendingHistoryOriginal"),
          after: t("cosmetics.pendingHistoryUpdated"),
        },
      ];
    }
    if (baseline.ownedSupportedCount === working.ownedSupportedCount) {
      return [...new Set([...baselineIds, ...workingIds])]
        .filter((id) => baselineIds.includes(id) !== workingIds.includes(id))
        .map((id) => ({
          after: pendingValue(Number(workingIds.includes(id))),
          before: pendingValue(Number(baselineIds.includes(id))),
          field: pendingField,
          id: `cosmetics:${id}`,
          subject: `${t("cosmetics.cosmeticId")} ${formatNumber(id)}`,
        }));
    }
    return [
      {
        after: pendingValue(working.ownedSupportedCount),
        before: pendingValue(baseline.ownedSupportedCount),
        field: pendingField,
        id: "cosmetics:supported-ownership",
        subject,
      },
    ];
  } catch {
    return [];
  }
}
