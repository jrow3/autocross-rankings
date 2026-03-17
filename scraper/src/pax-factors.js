// 2025 PAX/RTP factors from SCCA
// These normalize times across classes so we can compare drivers cross-class
// Updated annually by SCCA - check https://www.scca.com for latest

export const PAX_FACTORS = {
  // Street
  SS: 0.829,
  AS: 0.826,
  BS: 0.814,
  CS: 0.813,
  DS: 0.806,
  ES: 0.794,
  FS: 0.808,
  GS: 0.798,
  HS: 0.789,
  // Street Touring
  SST: 0.826,
  AST: 0.823,
  BST: 0.813,
  CST: 0.812,
  DST: 0.805,
  EST: 0.803,
  GST: 0.797,
  LST: 0.807,
  // Street Prepared
  SSP: 0.856,
  ASP: 0.851,
  BSP: 0.849,
  CSP: 0.854,
  DSP: 0.843,
  ESP: 0.838,
  FSP: 0.831,
  // Street Modified
  SM: 0.866,
  SMF: 0.853,
  SSM: 0.874,
  CSM: 0.830,
  // Prepared
  CP: 0.858,
  DP: 0.870,
  EP: 0.860,
  FP: 0.872,
  // Modified
  AM: 0.897,
  BM: 0.896,
  CM: 0.887,
  DM: 0.912,
  EM: 0.883,
  FM: 0.888,
  // CAM
  CAMC: 0.827,
  CAMS: 0.838,
  CAMT: 0.834,
  // Xtreme
  XA: 0.882,
  XB: 0.867,
  XS: 0.876,
  XU: 0.855,
  // Kart
  KM: 0.940,
  // Other
  SSC: 0.810,
  LS: 0.808,
  CSX: 0.807,
};

// Get PAX factor for a class, return 1.0 if unknown
export function getPaxFactor(className) {
  const normalized = className.trim().toUpperCase();
  return PAX_FACTORS[normalized] || 1.0;
}
