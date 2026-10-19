export type AdsgramInitOptions = {
  blockId: string;
  debug?: boolean;
  debugBannerType?: "RewardedVideo" | "FullscreenMedia";
};

// আপনার Adsgram Test Block ID
export const ADSGRAM_TEST_BLOCK_ID = "54866"; 

export function getAdsgramInitOptions(): AdsgramInitOptions {
  return {
    blockId: ADSGRAM_TEST_BLOCK_ID,
    debug: true, // এটি অবশ্যই true রাখতে হবে টেস্ট অ্যাডের জন্য
    debugBannerType: "RewardedVideo",
  };
}
