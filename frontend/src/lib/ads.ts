export type AdsgramInitOptions = {
  blockId: string;
  debug?: boolean;
  debugBannerType?: "RewardedVideo" | "FullscreenMedia";
};

export const ADSGRAM_TEST_BLOCK_ID = "int-41387";
export const ADSGRAM_PRODUCTION_BLOCK_ID = "41655";

/** Force a test rewarded creative only in development; production uses the live block. */
export function getAdsgramInitOptions(isDevelopment: boolean): AdsgramInitOptions {
  if (isDevelopment) {
    return {
      blockId: ADSGRAM_TEST_BLOCK_ID,
      debug: true,
      debugBannerType: "RewardedVideo",
    };
  }

  return { blockId: ADSGRAM_PRODUCTION_BLOCK_ID };
}
