export type AdsgramInitOptions = {
  blockId: string;
  debug?: boolean;
};

// আপনার Production Block ID
export const ADSGRAM_BLOCK_ID = "41655";

export function getAdsgramInitOptions(): AdsgramInitOptions {
  return {
    blockId: ADSGRAM_BLOCK_ID,
    debug: false,
  };
}
