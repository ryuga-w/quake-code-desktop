export type MobileFeatureFlags = {
  driverV2: boolean;
  scrcpyStream: boolean;
  buildJobs: boolean;
  semanticRefsV2: boolean;
  inspector: boolean;
  qualityLab: boolean;
};
function enabled(name: string, fallback = true): boolean { const value = process.env[name]; return value === undefined ? fallback : value !== "0" && value !== "false"; }
export function mobileFeatureFlags(): MobileFeatureFlags { return { driverV2: enabled("QUAKE_MOBILE_DRIVER_V2"), scrcpyStream: enabled("QUAKE_MOBILE_SCRCPY"), buildJobs: enabled("QUAKE_MOBILE_BUILD_JOBS"), semanticRefsV2: enabled("QUAKE_MOBILE_SEMANTIC_V2"), inspector: enabled("QUAKE_MOBILE_INSPECTOR"), qualityLab: enabled("QUAKE_MOBILE_QUALITY_LAB") }; }
