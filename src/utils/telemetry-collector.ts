export interface TelemetryData {
  mouseMoves: { x: number; y: number; t: number }[];
  clicks: { x: number; y: number; t: number }[];
  keyCount: number;
  touchCount: number;
  screenWidth: number;
  screenHeight: number;
  loadTime: number;
  clickTime: number;
  userAgent: string;
}

/**
 * Client-Side Telemetry Collector.
 * Records mouse vectors, click dynamics, and triggers AES-GCM payload encryption.
 */
export class TelemetryCollector {
  private mouseMoves: { x: number; y: number; t: number }[] = [];
  private clicks: { x: number; y: number; t: number }[] = [];
  private keyCount = 0;
  private touchCount = 0;
  private loadTime: number;

  constructor() {
    this.loadTime = Date.now();
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', this.handleMouseMove);
      window.addEventListener('mousedown', this.handleMouseDown);
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('touchstart', this.handleTouchStart);
    }
  }

  private handleMouseMove = (e: MouseEvent) => {
    this.mouseMoves.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    if (this.mouseMoves.length > 300) {
      this.mouseMoves.shift();
    }
  };

  private handleMouseDown = (e: MouseEvent) => {
    this.clicks.push({ x: e.clientX, y: e.clientY, t: Date.now() });
  };

  private handleKeyDown = () => {
    this.keyCount++;
  };

  private handleTouchStart = () => {
    this.touchCount++;
  };

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', this.handleMouseMove);
      window.removeEventListener('mousedown', this.handleMouseDown);
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('touchstart', this.handleTouchStart);
    }
  }

  async getEncryptedPayload(secret: string): Promise<string> {
    const data: TelemetryData = {
      mouseMoves: this.mouseMoves,
      clicks: this.clicks,
      keyCount: this.keyCount,
      touchCount: this.touchCount,
      screenWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
      screenHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
      loadTime: this.loadTime,
      clickTime: Date.now(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'headless',
    };

    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      return Buffer.from(JSON.stringify(data)).toString('base64');
    }

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.padEnd(32).slice(0, 32));
    const key = await window.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify(data))
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    let binary = '';
    const len = combined.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return window.btoa(binary);
  }
}
