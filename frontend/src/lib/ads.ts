export type AdsgramInitOptions = {
  blockId: string;
  debug?: boolean;
  debugBannerType?: "RewardedVideo" | "FullscreenMedia";
};

// Shudhu apnar main Block ID "41655" bebohar kora hocche
export const ADSGRAM_BLOCK_ID = "54866";

export function getAdsgramInitOptions(): AdsgramInitOptions {
  return {
    blockId: ADSGRAM_BLOCK_ID,
  };
}
