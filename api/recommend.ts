/**
 * @layer Application Layer —— 兼容层（deprecated）
 * @file api/recommend.ts
 *
 * 推荐引擎已迁移至 api/services/recommendService.ts + profileService.ts（arch-v5 §8）。
 * 本文件仅保留 re-export 以兼容历史 import，新代码请直接引用 services 层。
 */
export { recommendFeed, trackEvent } from "./services/recommendService";
export { getProfile, updateProfile, type Profile } from "./services/profileService";
