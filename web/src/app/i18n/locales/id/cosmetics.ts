import type { TranslationShape } from "@/app/i18n/types";
import { cosmeticsEn } from "@/app/i18n/locales/en/cosmetics";

export const cosmeticsId: TranslationShape<typeof cosmeticsEn> = {
  unavailable: "Cosmetics tidak tersedia",
  unavailableMessage: "Pengeditan cosmetics tidak tersedia untuk MetaSave ini.",
  eyebrow: "Save akun",
  title: "Cosmetics",
  unlocked: "{owned} dari {total} cosmetics yang didukung telah terbuka",
  complete: "Semua cosmetics yang didukung sudah terbuka.",
  remaining: {
    one: "{count} cosmetic yang didukung masih terkunci.",
    other: "{count} cosmetics yang didukung masih terkunci.",
  },
  action: "Buka Cosmetics Tersisa",
  cosmeticId: "ID Cosmetic",
  lockAll: "Kunci Semua Cosmetics",
  presets: "Perlengkapan dan preset tidak diubah.",
  lockBlocked: {
    equipped:
      "Kunci Semua diblokir karena cosmetic yang terbuka sedang dipakai. Lepas di R.E.P.O., tutup game, lalu impor MetaSave terbaru.",
    preset:
      "Kunci Semua diblokir karena cosmetic yang terbuka digunakan preset tersimpan. Hapus referensinya dari preset di R.E.P.O., tutup game, lalu impor MetaSave terbaru.",
    unverified:
      "Referensi perlengkapan atau preset tidak dapat diverifikasi. Impor MetaSave lengkap dari game. Referensi tidak akan dihapus di sini.",
    busy: "Operasi file sedang berlangsung. Tunggu hingga selesai.",
    empty: "Tidak ada cosmetic yang didukung yang sedang terbuka.",
  },
  lockConfirmTitle: "Kunci Semua Cosmetics?",
  lockConfirmBody: {
    one: "Ini menghapus kepemilikan {count} cosmetic yang didukung dari salinan kerja ini.",
    other: "Ini menghapus kepemilikan {count} cosmetics yang didukung dari salinan kerja ini.",
  },
  lockRestrictions:
    "Cosmetic yang dipakai atau dirujuk preset memblokir tindakan ini. Perlengkapan, preset, dan kepemilikan yang tidak didukung tidak akan dihapus. Unduh salinan terverifikasi untuk menyimpan perubahan.",
  preservedOwnership: {
    one: "{count} kepemilikan cosmetic yang tidak didukung dipertahankan.",
    other: "{count} kepemilikan cosmetics yang tidak didukung dipertahankan.",
  },
  confirmLock: {
    one: "Kunci {count} cosmetic",
    other: "Kunci {count} cosmetics",
  },
  cancelLock: "Batal",
  lockChanged: "Save atau kepemilikannya berubah. Batalkan dan tinjau Kunci Semua lagi.",
  pendingHistoryField: "Riwayat cosmetic",
  pendingHistoryOriginal: "Riwayat awal",
  pendingHistoryUpdated: "Riwayat diperbarui",
  pendingField: "Cosmetics yang didukung",
  pendingValue: "{count} terbuka",
};
