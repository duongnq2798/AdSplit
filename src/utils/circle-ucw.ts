import { W3SSdk } from '@circle-fin/w3s-pw-web-sdk';

/**
 * Circle User-Controlled Wallet SDK Client Service.
 * Wraps @circle-fin/w3s-pw-web-sdk calls in clean promise-based triggers.
 * Runs strictly client-side.
 */
export class CircleUCWService {
  private sdk: any;
  private appId: string;

  constructor() {
    // Read App ID from env or fallback to sandbox placeholder
    this.appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID || '8cbeec29-c09a-5f90-8e1d-4eb46b08db91';
    
    if (typeof window !== 'undefined') {
      try {
        this.sdk = new W3SSdk();
        this.sdk.setAppSettings({ appId: this.appId });
        console.log('[CircleUCWService] Web SDK successfully initialized.');
      } catch (err) {
        console.error('[CircleUCWService] Web SDK failed to initialize:', err);
      }
    }
  }

  /**
   * Configures JWT session user token and device encryption credentials.
   */
  setAuthentication(userToken: string, encryptionKey: string) {
    if (!this.sdk) {
      console.warn('[CircleUCWService] Cannot set authentication: SDK not loaded.');
      return;
    }
    this.sdk.setAuthentication({ userToken, encryptionKey });
    console.log('[CircleUCWService] Session credentials set.');
  }

  /**
   * Executes a user authentication or transaction challenge (e.g. PIN setup, signature check).
   * Prompts the secure iframe pin modal overlay.
   */
  executeChallenge(challengeId: string): Promise<{ type: string; status: string; data?: any }> {
    return new Promise((resolve, reject) => {
      if (!this.sdk) {
        return reject(new Error('Circle Web SDK not initialized (window context required).'));
      }

      this.sdk.execute(challengeId, (error: any, result: any) => {
        if (error) {
          console.error('[CircleUCWService] Challenge execution error:', error);
          return reject(error);
        }
        console.log('[CircleUCWService] Challenge execution success:', result);
        resolve(result);
      });
    });
  }
}

// Global client-side service instance
export const circleUCWService = new CircleUCWService();
