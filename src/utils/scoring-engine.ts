import { supabase } from './supabase';
import crypto from 'crypto';
import { TelemetryData } from './telemetry-collector';

const TELEMETRY_SECRET = process.env.TELEMETRY_SECRET || 'adsplit_secret_telemetry_key_32bytes';

/**
 * Decrypts the Web Crypto AES-GCM encrypted telemetry payload.
 */
async function decryptTelemetry(encryptedBase64: string): Promise<TelemetryData | null> {
  try {
    // If running in environment without correct base64 prefix or fallback, parse directly if it starts with {
    if (encryptedBase64.startsWith('{')) {
      return JSON.parse(encryptedBase64);
    }

    const combined = Buffer.from(encryptedBase64, 'base64');
    if (combined.length < 13) {
      // Too short to contain IV + ciphertext
      return null;
    }

    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);

    const encoder = new TextEncoder();
    const keyData = encoder.encode(TELEMETRY_SECRET.padEnd(32).slice(0, 32));

    const key = await crypto.webcrypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted)) as TelemetryData;
  } catch (err) {
    console.error('[ScoringEngine] Decryption failed:', err);
    return null;
  }
}

/**
 * Calculates the maximum perpendicular distance of points from a straight line.
 */
function calculateMaxLineDeviation(points: { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  const start = points[0];
  const end = points[points.length - 1];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = Math.sqrt(dx * dx + dy * dy);

  if (denominator === 0) return 0;

  let maxDeviation = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    // Perpendicular distance formula
    const distance = Math.abs(dy * p.x - dx * p.y + end.x * start.y - end.y * start.x) / denominator;
    if (distance > maxDeviation) {
      maxDeviation = distance;
    }
  }

  return maxDeviation;
}

/**
 * Telemetry Verification Scoring Engine.
 * Analyzes trajectories, interaction velocity, user agents, and IP records to flag click fraud.
 */
export async function verifyTelemetry(
  encryptedPayload: string,
  ipAddress: string,
  campaignId: string
): Promise<{ success: boolean; score: number; reason: string }> {
  // 1. Decrypt Telemetry Payload
  const telemetry = await decryptTelemetry(encryptedPayload);
  if (!telemetry) {
    return { success: false, score: 0, reason: 'FRAUD_DECRYPTION_FAILED: Telemetry payload tampered or invalid encryption.' };
  }

  const { mouseMoves, clicks, loadTime, clickTime, userAgent } = telemetry;

  // 2. Headless Browser Check
  const lowerUA = userAgent.toLowerCase();
  if (
    lowerUA.includes('headless') ||
    lowerUA.includes('puppeteer') ||
    lowerUA.includes('selenium') ||
    lowerUA.includes('playwright')
  ) {
    return { success: false, score: 10, reason: 'FRAUD_HEADLESS_BROWSER: Automated testing browser signature detected.' };
  }

  // 3. Execution Speed Check (Rapid click within 50ms)
  const duration = clickTime - loadTime;
  if (duration < 50) {
    return { success: false, score: 5, reason: `FRAUD_RAPID_EXECUTION: Click triggered in ${duration}ms (human physical limit is >50ms).` };
  }

  // 4. Straight Line/Zero Movement Bot Check
  if (mouseMoves.length === 0) {
    return { success: false, score: 15, reason: 'FRAUD_NO_MOUSE_MOVEMENT: Click triggered without any preceding cursor navigation.' };
  }

  if (mouseMoves.length >= 3) {
    const deviation = calculateMaxLineDeviation(mouseMoves);
    if (deviation < 0.5) {
      return { success: false, score: 20, reason: `FRAUD_PERFECT_STRAIGHT_LINE: Cursor movement has 0 curve deviation (${deviation.toFixed(4)}px), indicating bot coordinate generator.` };
    }
  }

  // 5. Duplicate IP Click Check (within 1 minute)
  try {
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const { data: duplicateLogs, error } = await supabase
      .from('click_logs')
      .select('id')
      .eq('ip_address', ipAddress)
      .eq('campaign_id', campaignId)
      .gt('timestamp', oneMinuteAgo)
      .limit(1);

    if (error) throw error;

    if (duplicateLogs && duplicateLogs.length > 0) {
      return { success: false, score: 30, reason: 'FRAUD_DUPLICATE_IP: Multiple clicks detected from same IP within 1 minute cooldown.' };
    }
  } catch (err) {
    console.warn('[ScoringEngine] Duplicate check database query bypass:', err);
  }

  // All anti-bot checks passed!
  return { success: true, score: 98, reason: 'HUMAN_VERIFIED: Natural curves, valid speed, and unique interaction profile.' };
}
