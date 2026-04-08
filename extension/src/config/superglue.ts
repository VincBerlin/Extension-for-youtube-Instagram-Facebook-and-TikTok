const SUPERGLUE_API_KEY = "f2078efb65ed46b59fbec08f454aeec0";

export const SUPERGLUE_HOOKS = {
  generateSummary:      `https://api.superglue.ai/v1/hooks/generate-summary?token=${SUPERGLUE_API_KEY}`,
  saveSummary:          `https://api.superglue.ai/v1/hooks/save-summary?token=${SUPERGLUE_API_KEY}`,
  generateTotalSummary: `https://api.superglue.ai/v1/hooks/generate-total-summary?token=${SUPERGLUE_API_KEY}`,
  getFolders:           `https://api.superglue.ai/v1/hooks/get-folders?token=${SUPERGLUE_API_KEY}`,
  createFolder:         `https://api.superglue.ai/v1/hooks/create-folder?token=${SUPERGLUE_API_KEY}`,
  getSummaries:         `https://api.superglue.ai/v1/hooks/get-summaries?token=${SUPERGLUE_API_KEY}`,
} as const;
